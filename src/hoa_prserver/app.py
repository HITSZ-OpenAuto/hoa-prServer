from __future__ import annotations

from fastapi import FastAPI
from pydantic import BaseModel, Field

from .render import render_readme_from_toml

app = FastAPI(title="hoa-prServer", version="0.1.0")


class RenderRequest(BaseModel):
    toml: str = Field(..., description="TOML text (readme.toml)")


class RenderResponse(BaseModel):
    readme_md: str


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/v1/readme/render", response_model=RenderResponse)
def render_readme(req: RenderRequest) -> RenderResponse:
    readme_md = render_readme_from_toml(req.toml)
    return RenderResponse(readme_md=readme_md)
