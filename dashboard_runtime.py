from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping


DEFAULT_BASE_DIR = Path.home() / ".openclaw"


@dataclass(frozen=True)
class RuntimeConfig:
    repo_dir: Path
    base_dir: Path
    workspace_dir: Path
    port: int


def resolve_runtime_config(
    repo_dir: str | Path | None = None,
    environ: Mapping[str, str] | None = None,
    port: int | None = None,
) -> RuntimeConfig:
    env = dict(os.environ if environ is None else environ)
    repo_path = Path(repo_dir) if repo_dir else Path(__file__).resolve().parent
    base_dir = Path(env.get("OPENCLAW_BASE_DIR") or DEFAULT_BASE_DIR).expanduser()
    workspace_dir = Path(env.get("OPENCLAW_WORKSPACE") or (base_dir / "workspace")).expanduser()
    resolved_port = int(port if port is not None else env.get("PORT") or 8080)
    return RuntimeConfig(
        repo_dir=repo_path.resolve(),
        base_dir=base_dir.resolve(),
        workspace_dir=workspace_dir.resolve(),
        port=resolved_port,
    )
