"""Summarize readme.toml for UI.

The frontend mainly needs:
- course_code/course_name/repo_type
- section item lists with preview (for "modify existing" UX)

We keep this tolerant: if parsing fails, we return minimal info.
"""

from __future__ import annotations

from typing import Any

import tomlkit
from tomlkit.items import AoT, Table


def _safe_str(v: Any) -> str:
    if v is None:
        return ""
    return str(v)


def _preview(text: str, *, limit: int = 80) -> str:
    s = (text or "").strip().replace("\r\n", "\n")
    if not s:
        return ""
    first = s.split("\n", 1)[0].strip()
    if len(first) > limit:
        return first[: limit - 1] + "…"
    return first


def summarize_toml(toml_text: str) -> dict[str, Any]:
    try:
        doc = tomlkit.parse(toml_text)
    except Exception:
        return {
            "meta": {"course_code": "", "course_name": "", "repo_type": ""},
            "sections": {},
        }

    meta = {
        "course_code": _safe_str(doc.get("course_code")),
        "course_name": _safe_str(doc.get("course_name")),
        "repo_type": _safe_str(doc.get("repo_type")),
    }

    sections: dict[str, Any] = {}

    # Scalar
    sections["description"] = {"preview": _preview(_safe_str(doc.get("description")))}

    def list_aot(name: str, *, label_key: str | None = None, preview_key: str | None = "content") -> None:
        v = doc.get(name)
        if not isinstance(v, AoT):
            sections[name] = {"items": []}
            return
        items = []
        for i, it in enumerate(v):
            if not isinstance(it, Table):
                continue
            label = _safe_str(it.get(label_key)) if label_key else ""
            # When preview_key is None, return empty string instead of extracting the whole table
            pv = _preview(_safe_str(it.get(preview_key))) if preview_key is not None else ""
            items.append({"index": i, "label": label, "preview": pv})
        sections[name] = {"items": items}

    list_aot("exam")
    list_aot("lab")
    list_aot("advice")
    list_aot("schedule")
    list_aot("course")
    list_aot("related_links")
    list_aot("misc", label_key="topic")
    list_aot("textbooks", label_key="title", preview_key=None)
    list_aot("online_resources", label_key="title", preview_key="description")

    # lecturers: name + reviews count
    lecturers_v = doc.get("lecturers")
    lecturers_items = []
    if isinstance(lecturers_v, AoT):
        for i, it in enumerate(lecturers_v):
            if not isinstance(it, Table):
                continue
            reviews_v = it.get("reviews")
            reviews_cnt = len(reviews_v) if isinstance(reviews_v, AoT) else 0
            lecturers_items.append(
                {
                    "index": i,
                    "label": _safe_str(it.get("name")),
                    "preview": f"{reviews_cnt} reviews",
                }
            )
    sections["lecturers"] = {"items": lecturers_items}

    return {"meta": meta, "sections": sections}
