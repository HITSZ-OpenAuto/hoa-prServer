"""Small TOML templates returned to clients.

If a repo (or readme.toml) doesn't exist yet, the frontend can start from a minimal
template and then POST the edited TOML back to the server.
"""

from __future__ import annotations


def normal_template(*, course_name: str, course_code: str) -> str:
    return (
        f"course_name = \"{course_name}\"\n"
        f"repo_type = \"normal\"\n"
        f"course_code = \"{course_code}\"\n\n"
        'description = """\n"\n"""\n'
    )


def multiproject_template(*, course_name: str, course_code: str) -> str:
    # Minimal stub; multi-project generally uses [[courses]]
    return (
        f"course_name = \"{course_name}\"\n"
        f"repo_type = \"multi-project\"\n"
        f"course_code = \"{course_code}\"\n\n"
        "[[courses]]\n"
        f"course_code = \"{course_code}\"\n"
        f"course_name = \"{course_name}\"\n"
        'description = """\n"\n"""\n'
    )
