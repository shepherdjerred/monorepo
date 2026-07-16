#!/bin/sh
# Fail-on-drift guard for the qBittorrent config (config-as-code).
#
# The committed qBittorrent.conf is the source of truth. qBittorrent rewrites
# its own config at runtime, so a fresh PVC is seeded from the committed file
# (see the init container) and, on every subsequent start, this guard asserts
# the live on-disk config still MATCHES the committed declaration. Any drift
# fails the pod so the operator must reconcile by committing the change.
#
# Only the keys WE declare in the committed seed are enforced. Keys qBittorrent
# writes on its own that we do not declare (e.g. WebUI\Password_PBKDF2,
# Network\Cookies) are ignored, so the guard never false-positives on the app's
# own runtime churn.
#
# A small set of ENGINE-OWNED keys are excluded from enforcement even though they
# appear in the committed seed (see the `excluded` list in the awk program below):
# qBittorrent/the linuxserver image mutates them without user intent, so enforcing
# them would crash-loop the pod on a routine version upgrade rather than flag a
# real config change.
#
# Usage: check-config-drift.sh <committed-seed-conf> <live-conf>
#   exit 0 -> in sync (or live config absent: nothing to compare yet)
#   exit 3 -> drift detected (offending keys printed to stderr)
#   other  -> the check itself failed to run
#
# NB: runs under busybox `sh`/`awk` in the linuxserver image with a read-only
# root filesystem, so it must not write temp files (output is captured in a
# shell variable).
set -u

SEED="${1:?usage: check-config-drift.sh <committed-seed-conf> <live-conf>}"
LIVE="${2:?usage: check-config-drift.sh <committed-seed-conf> <live-conf>}"

if [ ! -f "$LIVE" ]; then
  # No live config yet (fresh PVC). The caller seeds it; nothing to enforce.
  exit 0
fi

# Parse both files into section-qualified key=value pairs. Compare every key
# declared in the seed against the live value; report missing or changed keys.
report=$(
  awk -v seedfile="$SEED" '
    function trim(s) { sub(/^[ \t]+/, "", s); sub(/[ \t]+$/, "", s); return s }

    # Engine-owned keys excluded from drift enforcement. These are mutated by
    # qBittorrent / the linuxserver image itself (not by the operator), so
    # enforcing them would crash-loop the pod on a routine version upgrade
    # instead of catching a real config change:
    #   Meta\MigrationVersion - bumped when the image migrates the on-disk config
    #                           format after a qBittorrent version bump.
    # They stay in the committed seed (so a fresh PVC is seeded with a complete,
    # representative config) but are skipped in the comparison below.
    BEGIN { excluded["Meta" SUBSEP "MigrationVersion"] = 1 }

    # Reset the section at the start of each file (robust even if a file does
    # not open with a section header). Files are distinguished by FILENAME, not
    # the FNR==NR idiom, so an empty seed can never misclassify live records.
    FNR == 1 { section = "" }

    # Section header, e.g. [BitTorrent].
    /^[ \t]*\[.*\][ \t]*$/ {
      s = $0
      sub(/^[ \t]*\[/, "", s)
      sub(/\][ \t]*$/, "", s)
      section = s
      next
    }

    # key=value (split on the FIRST "=" so values may themselves contain "=").
    {
      eq = index($0, "=")
      if (eq == 0) { next }
      key = trim(substr($0, 1, eq - 1))
      val = substr($0, eq + 1)
      ckey = section SUBSEP key
      if (FILENAME == seedfile) { seed[ckey] = val; managed[ckey] = 1 }
      else { live[ckey] = val; haveLive[ckey] = 1 }
    }

    END {
      drift = 0
      for (k in managed) {
        if (k in excluded) { continue }
        split(k, a, SUBSEP)
        if (!(k in haveLive)) {
          printf("  - [%s] %s : missing from live config (declared=<%s>)\n", a[1], a[2], seed[k])
          drift = 1
        } else if (live[k] != seed[k]) {
          printf("  - [%s] %s : declared=<%s> live=<%s>\n", a[1], a[2], seed[k], live[k])
          drift = 1
        }
      }
      exit (drift ? 3 : 0)
    }
  ' "$SEED" "$LIVE"
)
rc=$?

if [ "$rc" -eq 0 ]; then
  exit 0
fi

if [ "$rc" -eq 3 ]; then
  echo "ERROR: qBittorrent config drift detected." >&2
  echo "The committed qBittorrent.conf is the source of truth; drift is not tolerated." >&2
  echo "Drifted managed keys (committed vs live):" >&2
  printf '%s\n' "$report" >&2
  echo "Reconcile by updating" >&2
  echo "  packages/homelab/src/cdk8s/src/resources/configs/qbittorrent/qBittorrent.conf" >&2
  echo "to match the live value (or revert the live change) and commit, then redeploy." >&2
  echo "Only keys present in that committed file are enforced; qBittorrent's own" >&2
  echo "runtime-managed and engine-owned keys are ignored." >&2
  exit 3
fi

echo "ERROR: qBittorrent config drift check failed to run (awk exited $rc):" >&2
printf '%s\n' "$report" >&2
exit "$rc"
