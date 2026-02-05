"""FastAPI application entry.

Exposes JSON APIs for:
- listing org repos
- course/repo lookup and fetching readme.toml
- submitting TOML to create PR (or enqueue pending if repo missing)
- background poller that watches pending requests and creates PRs when repos appear
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from .auth import require_api_key
from .db import get_request, init_db, insert_pending, list_by_status, update_status
from .emailer import send_admin_email
from .github_client import GitHubClient, normalize_repo_name
from .pr_flow import PRFlowError, create_pr_from_toml
from .render import render_readme_from_toml
from .settings import Settings, is_repo_allowed, load_settings
from .toml_templates import multiproject_template, normal_template

log = logging.getLogger("hoa_prserver")


def create_app() -> FastAPI:
    settings = load_settings()
    init_db(settings.db_path)

    app = FastAPI(title="hoa-prServer", version="0.1.0")
    app.state.settings = settings
    app.state.github = GitHubClient(token=settings.github_token)

    @app.on_event("startup")
    async def _startup() -> None:
        app.state._poller_task = asyncio.create_task(_poller_loop(app))

    @app.on_event("shutdown")
    async def _shutdown() -> None:
        task = getattr(app.state, "_poller_task", None)
        if task:
            task.cancel()

    return app


app = create_app()


def _settings_dep() -> Settings:
    return app.state.settings


def _github_dep() -> GitHubClient:
    return app.state.github


def _auth_dep(
    x_api_key: str | None = Header(default=None),
    settings: Settings = Depends(_settings_dep),
) -> None:
    require_api_key(settings, x_api_key)


class RenderRequest(BaseModel):
    toml: str = Field(..., description="TOML text (readme.toml)")


class RenderResponse(BaseModel):
    readme_md: str


class RepoInfo(BaseModel):
    name: str
    full_name: str
    html_url: str
    default_branch: str


class LookupResponse(BaseModel):
    exists: bool
    repo: RepoInfo | None = None
    toml: str


class SubmitRequest(BaseModel):
    repo_name: str | None = Field(
        default=None,
        description=(
            "Optional: override target GitHub repo name. "
            "If omitted, course_code is used as repo name."
        ),
    )
    course_code: str = Field(..., description="Course code, also used as repo name by default")
    course_name: str
    repo_type: str = Field("normal", description="normal | multi-project")
    toml: str = Field(..., description="Full TOML payload")


class SubmitResponse(BaseModel):
    status: str
    request_id: int | None = None
    pr_url: str | None = None


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/v1/readme/render", response_model=RenderResponse)
def render_readme(req: RenderRequest) -> RenderResponse:
    readme_md = render_readme_from_toml(req.toml)
    return RenderResponse(readme_md=readme_md)


@app.get("/v1/org/repos", response_model=list[RepoInfo])
async def list_repos(
    q: str = "",
    limit: int = 200,
    settings: Settings = Depends(_settings_dep),
    gh: GitHubClient = Depends(_github_dep),
    _auth: None = Depends(_auth_dep),
) -> list[RepoInfo]:
    repos = await gh.list_org_repos(settings.org_name, limit=max(1, min(limit, 500)))
    if settings.allowed_repos is not None:
        repos = [r for r in repos if r.name in settings.allowed_repos]
    if q:
        q_lower = q.lower()
        repos = [r for r in repos if q_lower in (r.name or "").lower()]
    return [RepoInfo(**r.__dict__) for r in repos]


@app.get("/v1/courses/lookup", response_model=LookupResponse)
async def lookup_course(
    course_code: str,
    repo_name: str | None = None,
    course_name: str = "",
    repo_type: str = "normal",
    settings: Settings = Depends(_settings_dep),
    gh: GitHubClient = Depends(_github_dep),
    _auth: None = Depends(_auth_dep),
) -> LookupResponse:
    resolved_repo_name = normalize_repo_name(repo_name or course_code)
    if not is_repo_allowed(settings, resolved_repo_name):
        raise HTTPException(status_code=403, detail="repo not allowed in current server config")
    repo = await gh.get_repo(settings.org_name, resolved_repo_name)

    if repo is None:
        tmpl = (
            multiproject_template(course_name=course_name or course_code, course_code=course_code)
            if repo_type == "multi-project"
            else normal_template(course_name=course_name or course_code, course_code=course_code)
        )
        return LookupResponse(exists=False, repo=None, toml=tmpl)

    toml_text = await gh.get_file_text(
        settings.org_name, resolved_repo_name, "readme.toml", ref=repo.default_branch
    )
    if toml_text is None:
        toml_text = (
            multiproject_template(course_name=course_name or course_code, course_code=course_code)
            if repo_type == "multi-project"
            else normal_template(course_name=course_name or course_code, course_code=course_code)
        )

    return LookupResponse(exists=True, repo=RepoInfo(**repo.__dict__), toml=toml_text)


@app.post("/v1/courses/submit", response_model=SubmitResponse)
async def submit_course(
    req: SubmitRequest,
    settings: Settings = Depends(_settings_dep),
    gh: GitHubClient = Depends(_github_dep),
    _auth: None = Depends(_auth_dep),
) -> SubmitResponse:
    resolved_repo_name = normalize_repo_name(req.repo_name or req.course_code)
    if not is_repo_allowed(settings, resolved_repo_name):
        raise HTTPException(status_code=403, detail="repo not allowed in current server config")
    repo = await gh.get_repo(settings.org_name, resolved_repo_name)

    if repo is None:
        request_id = insert_pending(
            settings.db_path,
            org=settings.org_name,
            repo=resolved_repo_name,
            course_code=req.course_code,
            course_name=req.course_name,
            repo_type=req.repo_type,
            toml_text=req.toml,
            status="waiting_repo",
        )

        send_admin_email(
            settings,
            subject=f"[hoa-prServer] 仓库不存在：{resolved_repo_name}",
            text=(
                f"收到提交，但组织 {settings.org_name} 下尚不存在仓库 {resolved_repo_name}。\n"
                f"course_code: {req.course_code}\n"
                f"course_name: {req.course_name}\n"
                f"request_id: {request_id}\n\n"
                "请管理员创建仓库后，服务端会按小时轮询并自动创建 PR。\n"
            ),
        )

        return SubmitResponse(status="waiting_repo", request_id=request_id)

    if not settings.github_token:
        raise HTTPException(status_code=400, detail="GITHUB_TOKEN not configured")

    try:
        pr = await create_pr_from_toml(
            gh=gh,
            org=settings.org_name,
            repo=resolved_repo_name,
            default_branch=repo.default_branch,
            github_token=settings.github_token,
            toml_text=req.toml,
            toml_path="readme.toml",
            readme_path="README.md",
            title=f"chore: update {req.course_code} readme.toml",
            body="Automated PR via hoa-prServer.",
            branch_prefix="bot/rdme",
        )
    except PRFlowError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return SubmitResponse(status="pr_created", pr_url=pr.pr_url)


@app.get("/v1/requests/{request_id}")
async def get_pending_request(
    request_id: int,
    settings: Settings = Depends(_settings_dep),
    _auth: None = Depends(_auth_dep),
) -> dict:
    r = get_request(settings.db_path, request_id)
    if not r:
        raise HTTPException(status_code=404, detail="not found")
    return r.__dict__


async def _poller_loop(app: FastAPI) -> None:
    settings: Settings = app.state.settings
    gh: GitHubClient = app.state.github

    while True:
        try:
            pending = list_by_status(settings.db_path, "waiting_repo", limit=50)
            for it in pending:
                if not is_repo_allowed(settings, it.repo):
                    update_status(settings.db_path, it.id, status="failed", last_error="repo not allowed")
                    continue
                repo = await gh.get_repo(it.org, it.repo)
                if repo is None:
                    continue

                if not settings.github_token:
                    update_status(settings.db_path, it.id, status="failed", last_error="GITHUB_TOKEN not configured")
                    continue

                try:
                    pr = await create_pr_from_toml(
                        gh=gh,
                        org=it.org,
                        repo=it.repo,
                        default_branch=repo.default_branch,
                        github_token=settings.github_token,
                        toml_text=it.toml_text,
                        title=f"chore: update {it.course_code} readme.toml",
                        body="Automated PR via hoa-prServer (delayed until repo existed).",
                        branch_prefix="bot/rdme",
                    )
                    update_status(settings.db_path, it.id, status="pr_created", pr_url=pr.pr_url)
                except Exception as e:
                    update_status(settings.db_path, it.id, status="failed", last_error=str(e))

        except Exception as e:
            log.exception("poller loop error: %s", e)

        await asyncio.sleep(max(10, settings.poll_interval_seconds))
