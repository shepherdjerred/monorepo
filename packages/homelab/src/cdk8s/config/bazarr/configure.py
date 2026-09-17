"""Apply the repo's provider policy before Bazarr starts; never log config."""

import os
import tempfile
from pathlib import Path

import yaml


def configure(path: Path, initial_owner: tuple[int, int] | None = None) -> None:
    config: object
    if path.exists():
        stat = path.stat()
        mode, uid, gid = stat.st_mode, stat.st_uid, stat.st_gid
        with path.open(encoding="utf-8") as source:
            config = yaml.safe_load(source)
    else:
        if path.with_suffix(".ini").exists():
            raise ValueError("migrate the existing Bazarr INI configuration before applying policy")
        # Bazarr's validators supply all remaining application defaults on its
        # first start. Seed only our policy, without inventing provider keys.
        path.parent.mkdir(parents=True, exist_ok=True)
        parent = path.parent.stat()
        uid, gid = initial_owner if initial_owner is not None else (parent.st_uid, parent.st_gid)
        mode = 0o600
        config = dict[str, object](general={"enabled_providers": []})
    if not isinstance(config, dict):
        raise ValueError("invalid Bazarr configuration")
    general = config.get("general")
    if not isinstance(general, dict):
        raise ValueError("invalid Bazarr general configuration")
    providers = general.get("enabled_providers")
    if not isinstance(providers, list) or not all(isinstance(p, str) for p in providers):
        raise ValueError("invalid provider configuration")
    providers = [p for p in providers if p != "assrt"]
    if "subhd" not in providers:
        providers.append("subhd")
    general["enabled_providers"] = providers
    opensubtitles = config.setdefault("opensubtitlescom", {})
    if not isinstance(opensubtitles, dict):
        raise ValueError("invalid OpenSubtitles configuration")
    opensubtitles["include_ai_translated"] = False
    opensubtitles["include_machine_translated"] = False
    # Atomic replacement preserves ownership and permissions of the secret-
    # bearing application config. No credentials enter a manifest or log.
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as target:
        temporary = Path(target.name)
    try:
        with temporary.open("w", encoding="utf-8") as target:
            yaml.safe_dump(config, target, allow_unicode=True, sort_keys=False)
        os.chmod(temporary, mode)
        os.chown(temporary, uid, gid)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    try:
        configure(Path("/config/config/config.yaml"), (int(os.environ["PUID"]), int(os.environ["PGID"])))
    except Exception:
        # YAML/parser exceptions can contain a credential-bearing source line.
        raise SystemExit("Bazarr provider policy failed; inspect configuration privately") from None
