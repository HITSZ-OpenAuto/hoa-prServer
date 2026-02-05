"""Thin GitHub REST API client.

Responsibilities:
- list org repos
- check repo existence
- read file contents (readme.toml)
- create pull requests
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import httpx


@dataclass(frozen=True)
class GitHubRepo:
    name: str
    full_name: str
    html_url: str
    default_branch: str


class GitHubError(RuntimeError):
    pass


class GitHubClient:
    def __init__(self, *, token: str | None) -> None:
        self._token = token

    def _headers(self) -> dict[str, str]:
        headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "hoa-prServer",
        }
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"
        return headers

    async def list_org_repos(self, org: str, *, limit: int = 200) -> list[GitHubRepo]:
        repos: list[GitHubRepo] = []
        per_page = 100
        page = 1
        async with httpx.AsyncClient(timeout=30) as client:
            while len(repos) < limit:
                url = f"https://api.github.com/orgs/{org}/repos"
                r = await client.get(
                    url,
                    headers=self._headers(),
                    params={"per_page": per_page, "page": page},
                )
                if r.status_code >= 400:
                    raise GitHubError(f"list repos failed: {r.status_code} {r.text}")

                items = r.json()
                if not isinstance(items, list) or not items:
                    break

                for it in items:
                    if not isinstance(it, dict):
                        continue
                    repos.append(
                        GitHubRepo(
                            name=str(it.get("name") or ""),
                            full_name=str(it.get("full_name") or ""),
                            html_url=str(it.get("html_url") or ""),
                            default_branch=str(it.get("default_branch") or "main"),
                        )
                    )
                    if len(repos) >= limit:
                        break

                page += 1

        return repos

    async def get_repo(self, org: str, repo: str) -> GitHubRepo | None:
        async with httpx.AsyncClient(timeout=30) as client:
            url = f"https://api.github.com/repos/{org}/{repo}"
            r = await client.get(url, headers=self._headers())
            if r.status_code == 404:
                return None
            if r.status_code >= 400:
                raise GitHubError(f"get repo failed: {r.status_code} {r.text}")
            it = r.json()
            return GitHubRepo(
                name=str(it.get("name") or ""),
                full_name=str(it.get("full_name") or ""),
                html_url=str(it.get("html_url") or ""),
                default_branch=str(it.get("default_branch") or "main"),
            )

    async def get_file_text(self, org: str, repo: str, path: str, *, ref: str | None = None) -> str | None:
        async with httpx.AsyncClient(timeout=30) as client:
            url = f"https://api.github.com/repos/{org}/{repo}/contents/{path}"
            params = {}
            if ref:
                params["ref"] = ref
            r = await client.get(url, headers=self._headers(), params=params)
            if r.status_code == 404:
                return None
            if r.status_code >= 400:
                raise GitHubError(f"get file failed: {r.status_code} {r.text}")
            data = r.json()
            if not isinstance(data, dict):
                return None
            if data.get("encoding") != "base64":
                return None
            import base64

            content = data.get("content")
            if not isinstance(content, str):
                return None
            # GitHub inserts line breaks in base64.
            b = base64.b64decode(re.sub(r"\s+", "", content))
            return b.decode("utf-8", errors="replace")

    async def create_pull_request(
        self,
        org: str,
        repo: str,
        *,
        title: str,
        body: str,
        head: str,
        base: str,
    ) -> str:
        if not self._token:
            raise GitHubError("GITHUB_TOKEN is required to create PR")

        async with httpx.AsyncClient(timeout=30) as client:
            url = f"https://api.github.com/repos/{org}/{repo}/pulls"
            r = await client.post(
                url,
                headers=self._headers(),
                json={"title": title, "body": body, "head": head, "base": base},
            )
            if r.status_code >= 400:
                raise GitHubError(f"create PR failed: {r.status_code} {r.text}")
            data = r.json()
            pr_url = data.get("html_url")
            return str(pr_url or "")


_RE_SAFE = re.compile(r"^[A-Za-z0-9_.-]+$")


def normalize_repo_name(repo: str) -> str:
    repo = repo.strip()
    if not repo or "/" in repo or "\\" in repo:
        raise ValueError("invalid repo name")
    if not _RE_SAFE.match(repo):
        raise ValueError("invalid repo name")
    return repo
