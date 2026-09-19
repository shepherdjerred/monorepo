"""Apply the repo's provider policy before Bazarr starts; never log config."""

import json
import os
import sqlite3
import tempfile
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen

import yaml

CHINESE_TAG = "chinese"
CHINESE_PROFILE_ID = 2


def configure_profile_tag(config_path: Path) -> None:
    database = config_path.parent.parent / "db" / "bazarr.db"
    if not database.exists():
        return
    try:
        connection = sqlite3.connect(database)
        cursor = connection.execute(
            "UPDATE table_languages_profiles SET tag = ? WHERE profileId = ?",
            (CHINESE_TAG, CHINESE_PROFILE_ID),
        )
        if cursor.rowcount != 1:
            raise ValueError("Simplified Chinese language profile is missing")
        connection.commit()
    except sqlite3.Error:
        raise ValueError("unable to configure Simplified Chinese language profile") from None
    finally:
        if "connection" in locals():
            connection.close()


def sonarr_endpoint(config: dict[str, object]) -> tuple[str, str] | None:
    sonarr = config.get("sonarr")
    if sonarr is None:
        return None
    if not isinstance(sonarr, dict):
        raise ValueError("invalid Sonarr configuration")
    host = sonarr.get("ip")
    port = sonarr.get("port")
    api_key = sonarr.get("apikey")
    ssl = sonarr.get("ssl", False)
    base_url = sonarr.get("base_url", "")
    if (
        not isinstance(host, str)
        or not host
        or not isinstance(port, int)
        or not isinstance(api_key, str)
        or not api_key
        or not isinstance(ssl, bool)
        or not isinstance(base_url, str)
    ):
        raise ValueError("invalid Sonarr configuration")
    scheme = "https" if ssl else "http"
    path = "/" + base_url.strip("/")
    if path != "/":
        path += "/"
    return f"{scheme}://{host}:{port}{path}api/v3/tag", api_key


def sonarr_json(request: Request) -> object:
    try:
        with urlopen(request, timeout=10) as response:
            return json.loads(response.read())
    except (OSError, URLError, ValueError):
        raise ValueError("unable to configure Sonarr Chinese tag") from None


def ensure_sonarr_tag(config: dict[str, object]) -> None:
    endpoint = sonarr_endpoint(config)
    if endpoint is None:
        return
    url, api_key = endpoint
    headers = {"X-Api-Key": api_key}
    tags = sonarr_json(Request(url, headers=headers))
    if not isinstance(tags, list) or not all(isinstance(tag, dict) for tag in tags):
        raise ValueError("unable to configure Sonarr Chinese tag")
    if any(tag.get("label") == CHINESE_TAG for tag in tags):
        return
    payload = json.dumps({"label": CHINESE_TAG}).encode()
    created = sonarr_json(
        Request(
            url,
            data=payload,
            headers={**headers, "Content-Type": "application/json"},
            method="POST",
        )
    )
    if not isinstance(created, dict) or created.get("label") != CHINESE_TAG:
        raise ValueError("unable to configure Sonarr Chinese tag")


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
    assrt = config.get("assrt")
    if assrt is not None and not isinstance(assrt, dict):
        raise ValueError("invalid ASSRT configuration")
    assrt_enabled = (
        isinstance(assrt, dict)
        and isinstance(assrt.get("token"), str)
        and bool(assrt["token"])
    )
    providers = [provider for provider in providers if provider != "assrt" or assrt_enabled]
    if assrt_enabled and "assrt" not in providers:
        providers.append("assrt")
    if "subhd" not in providers:
        providers.append("subhd")
    general["enabled_providers"] = providers
    general["serie_tag_enabled"] = True
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
    configure_profile_tag(path)
    ensure_sonarr_tag(config)


if __name__ == "__main__":
    try:
        configure(Path("/config/config/config.yaml"), (int(os.environ["PUID"]), int(os.environ["PGID"])))
    except Exception:
        # YAML/parser exceptions can contain a credential-bearing source line.
        raise SystemExit("Bazarr provider policy failed; inspect configuration privately") from None
