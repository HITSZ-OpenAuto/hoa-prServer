from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path
import sys


class RenderError(RuntimeError):
    pass


def _find_converter_script() -> Path:
    # Preferred: bundled script in this repo.
    repo_root = Path(__file__).resolve().parents[2]
    bundled = repo_root / "scripts" / "convert_toml_to_readme.py"
    if bundled.exists():
        return bundled

    raise RenderError("converter script not found: scripts/convert_toml_to_readme.py")


def render_readme_from_toml(toml_text: str) -> str:
    converter = _find_converter_script()

    with tempfile.TemporaryDirectory(prefix="hoa-prserver-") as tmp:
        tmp_path = Path(tmp)
        toml_path = tmp_path / "readme.toml"
        readme_path = tmp_path / "README.md"

        toml_path.write_text(toml_text, encoding="utf-8", newline="\n")

        env = os.environ.copy()
        env.setdefault("PYTHONUTF8", "1")

        proc = subprocess.run(
            [
                sys.executable,
                "-u",
                str(converter),
                "--input",
                str(toml_path),
                "--overwrite",
            ],
            cwd=str(tmp_path),
            env=env,
            capture_output=True,
            text=True,
        )
        if proc.returncode != 0:
            raise RenderError(
                "render failed\n"
                f"stdout:\n{proc.stdout}\n\n"
                f"stderr:\n{proc.stderr}\n"
            )

        if not readme_path.exists():
            raise RenderError("render succeeded but README.md not produced")

        return readme_path.read_text(encoding="utf-8")
