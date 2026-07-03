#!/usr/bin/env bash
# Import existing Asus device config into OpenTofu state.
#
# Idempotent: resources already in state are skipped, so it is safe to re-run
# after adding new resources. Run from packages/homelab/src/tofu with creds:
#
#   op run --env-file=.env -- ./asuswrt/import.sh
#
# Requires `tofu -chdir=asuswrt init` to have been run first.
set -euo pipefail

CHDIR="$(cd "$(dirname "$0")" && pwd)"
cd "$CHDIR/.."

# address <TAB> import-id. IDs: system=singleton, lease=MAC, port-forward=name,
# wireless=band index.
IMPORTS=$(
  cat <<'EOF'
asuswrt_system.router	system
asuswrt_dhcp_static_lease.plex_host	08:BF:B8:D4:59:7F
asuswrt_dhcp_static_lease.lease_61	48:DA:35:6F:61:BF
asuswrt_dhcp_static_lease.lease_90	4C:B9:EA:97:90:5A
asuswrt_dhcp_static_lease.lease_43	50:26:EF:28:F1:DE
asuswrt_dhcp_static_lease.lease_173	50:26:EF:29:70:EE
asuswrt_port_forward.plex	Plex
asuswrt_port_forward.minecraft_mc_router	Minecraft mc-router
asuswrt_port_forward.minecraft_bedrock	Mineraft Bedrock
asuswrt_wireless_network.wl0	0
asuswrt_wireless_network.wl1	1
asuswrt_system.ax88u	system
asuswrt_wireless_network.ax88u_wl0	0
asuswrt_wireless_network.ax88u_wl1	1
asuswrt_system.be86u	system
EOF
)

# Empty on first run (no state file yet); handle that explicitly without
# suppressing stderr.
if existing="$(tofu -chdir=asuswrt state list 2>&1)"; then
  :
else
  existing=""
fi

while IFS=$'\t' read -r addr id; do
  [ -z "$addr" ] && continue
  if printf '%s\n' "$existing" | grep -qxF "$addr"; then
    echo "skip   $addr (already in state)"
    continue
  fi
  echo "import $addr <= $id"
  tofu -chdir=asuswrt import "$addr" "$id"
done <<EOF
$IMPORTS
EOF

echo "Done. Run: op run --env-file=.env -- tofu -chdir=asuswrt plan"
