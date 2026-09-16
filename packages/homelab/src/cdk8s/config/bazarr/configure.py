"""Apply the repo's provider policy before Bazarr starts; never log config."""
import os
import tempfile
from pathlib import Path

import yaml


def configure(path):
    stat = path.stat()
    with path.open() as source:
        config = yaml.safe_load(source)
    if not isinstance(config, dict) or not isinstance(config.get("general"), dict):
        raise ValueError("invalid Bazarr configuration")
    providers = config["general"]["enabled_providers"]
    if not isinstance(providers, list) or not all(isinstance(p, str) for p in providers):
        raise ValueError("invalid provider configuration")
    providers = [p for p in providers if p != "assrt"]
    if "subhd" not in providers:
        providers.append("subhd")
    config["general"]["enabled_providers"] = providers
    opensubtitles = config.setdefault("opensubtitlescom", {})
    opensubtitles["include_ai_translated"] = False
    opensubtitles["include_machine_translated"] = False
    # Atomic replacement preserves ownership and permissions of the secret-
    # bearing application config. No credentials enter a manifest or log.
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as target:
        temporary = Path(target.name)
        yaml.safe_dump(config, target, allow_unicode=True, sort_keys=False)
    try:
        os.chmod(temporary, stat.st_mode)
        os.chown(temporary, stat.st_uid, stat.st_gid)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    try:
        configure(Path("/config/config/config.yaml"))
    except Exception:
        # YAML/parser exceptions can contain a credential-bearing source line.
        raise SystemExit("Bazarr provider policy failed; inspect configuration privately") from None
