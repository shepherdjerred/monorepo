#!/usr/bin/env bash
# Boot the-storm-server twice on a fresh volume, the way the chart runs it
# (uid 1000, gid 3000, fsGroup 2000, read-only root, no capabilities), and
# check what a release depends on:
#
#   1. first boot (online): Paper reaches "Done", every baked plugin logs
#      "Enabling", none fails to enable, TheStorm enables;
#   2. between boots: seed runtime state the image must never touch (a row in
#      plugins/TheStorm/the-storm.db, a runtime file next to it) and a stray
#      jar REMOVE_OLD_MODS must delete;
#   3. second boot with --network none: still reaches "Done" with every plugin
#      enabled, the runtime state survived, the stray jar is gone, and
#      /data/plugins/*.jar is exactly the image's jar set.
#
#   boot-check.sh <image> [log-dir]
set -euo pipefail

image=$1
logs=${2:-$(mktemp -d)}
mkdir -p "$logs"
volume=the-storm-boot-check-$$
manifest=$(docker run --rm --entrypoint cat "$image" /opt/the-storm/plugins.json)
mapfile -t plugins < <(jq -r '.plugins[].name' <<<"$manifest")
plugins+=(LWC TheStorm)

cleanup() { docker volume rm -f "$volume" >/dev/null; }
trap cleanup EXIT
docker volume create "$volume" >/dev/null
# What the kubelet does for fsGroup 2000: the volume root belongs to the group
# and is setgid, so uid 1000 with supplementary group 2000 can write it.
docker run --rm --user 0:0 --mount "type=volume,src=$volume,dst=/data" \
  --entrypoint chown "$image" 1000:2000 /data
docker run --rm --user 0:0 --mount "type=volume,src=$volume,dst=/data" \
  --entrypoint chmod "$image" 2775 /data

on_volume() { # run a command against the volume as the server's user
  docker run --rm --user 1000:3000 --group-add 2000 \
    --mount "type=volume,src=$volume,dst=/data,volume-nocopy" \
    --entrypoint "$1" "$image" "${@:2}"
}

boot() { # label [docker run args...]
  local label=$1 name=the-storm-boot-check-$1-$$
  shift
  docker run -d --name "$name" "$@" \
    --user 1000:3000 --group-add 2000 --read-only \
    --tmpfs /tmp:exec,uid=1000,gid=3000 \
    --cap-drop ALL --security-opt no-new-privileges \
    --mount "type=volume,src=$volume,dst=/data,volume-nocopy" \
    -e EULA=TRUE -e ONLINE_MODE=FALSE -e MEMORY=3G \
    -e SPAWN_PROTECTION=0 -e CFG_DISCORD_CHANNEL_ID=storm-boot-check-channel \
    "$image" >/dev/null
  local started=$SECONDS
  for _ in $(seq 1 600); do
    docker logs "$name" 2>&1 | grep -qE 'Done \([0-9.]+s\)!' && break
    [[ $(docker inspect -f '{{.State.Running}}' "$name") == true ]] || break
    sleep 1
  done
  local ready=$((SECONDS - started))
  docker stop -t 90 "$name" >/dev/null
  docker logs -t "$name" >"$logs/$label.log" 2>&1
  docker rm "$name" >/dev/null
  local log=$logs/$label.log
  grep -qE 'Done \([0-9.]+s\)!' "$log" || fail "$label: server never reached Done (see $log)"
  echo "[$label] Done after ${ready}s ($(grep -oE 'Done \([0-9.]+s\)' "$log"))"
  for plugin in "${plugins[@]}"; do
    grep -qE "\[$plugin\] Enabling $plugin v" "$log" || fail "$label: $plugin never logged Enabling"
  done
  if grep -E 'Error occurred while enabling|Could not load plugin|Ambiguous plugin name' "$log"; then
    fail "$label: a plugin failed to load or enable"
  fi
  # A plugin that disables itself before "Done" (e.g. an unsupported server
  # version) is not running. DiscordSRV is exempt: without a bot token, which
  # a local check never has, it disables itself by design.
  if awk '/Done \(/ { exit } { print }' "$log" |
    grep -E '\] Disabling [A-Za-z0-9_-]+ v' | grep -v '\[DiscordSRV\]'; then
    fail "$label: a plugin disabled itself during startup"
  fi
  echo "[$label] all ${#plugins[@]} plugins enabled"
}

fail() {
  echo "boot-check: $*" >&2
  exit 1
}

boot first

on_volume python3 -c '
import sqlite3
db = sqlite3.connect("/data/plugins/TheStorm/the-storm.db")
db.execute("CREATE TABLE boot_check (marker TEXT)")
db.execute("INSERT INTO boot_check VALUES (?)", ("survives",))
db.commit()
'
on_volume bash -c 'echo runtime >/data/plugins/TheStorm/runtime-state.txt && echo stray >/data/plugins/Stray-1.0.jar'

boot offline --network none

on_volume python3 -c '
import sqlite3
row = sqlite3.connect("/data/plugins/TheStorm/the-storm.db").execute("SELECT marker FROM boot_check").fetchone()
assert row == ("survives",), row
' || fail "the-storm.db lost its data across a boot"
on_volume test -f /data/plugins/TheStorm/runtime-state.txt || fail "runtime file in plugins/TheStorm was deleted"
on_volume test ! -e /data/plugins/Stray-1.0.jar || fail "REMOVE_OLD_MODS left a stray jar"
expected=$( (jq -r '.plugins[].file' <<<"$manifest"; echo LWCX-2.4.2.jar; echo TheStorm.jar) | sort)
actual=$(on_volume find /data/plugins -maxdepth 1 -name '*.jar' -printf '%f\n' | sort)
[[ $expected == "$actual" ]] || fail "/data/plugins jars differ from the image: $(diff <(echo "$expected") <(echo "$actual"))"
on_volume grep -qx 'spawn-protection=0' /data/server.properties ||
  fail "server.properties does not turn vanilla spawn protection off"
# Patched from the second boot on, with the channel interpolated from env.
on_volume grep -q 'storm-boot-check-channel' /data/plugins/DiscordSRV/config.yml ||
  fail "DiscordSRV config.yml was not patched with CFG_DISCORD_CHANNEL_ID"
echo "boot-check passed; logs in $logs"
