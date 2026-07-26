#!/usr/bin/env bash

# Buildx can print a transport error and then emit enough Go panic frames to
# push the original error outside bake-images.sh's bounded failure tail. Keep
# the panic signature specific: arbitrary Buildx panics remain hard failures.
# `error reading from server: EOF` / `failed to receive status` are how buildx
# reports the remote BuildKit driver dropping the gRPC stream mid-solve (the
# in-cluster buildkitd restarting or shedding a connection under parallel load).
# That is a transport transient, not a Dockerfile error, so a retry re-uses the
# warm cache and re-attempts only the interrupted target.
readonly BAKE_TRANSIENT_RE='Request timed out|i/o timeout|TLS handshake|remote error: tls|connection reset|connection refused|net/http:|failed to do request|dial tcp|temporary failure in name resolution|Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout|blob unknown|failed to resolve source metadata|unexpected EOF|error reading from server: EOF|failed to receive status|panic: send on closed channel|context deadline exceeded|error: failed to download'

bake_failure_is_transient() {
  if [ "$#" -ne 1 ]; then
    echo "bake_failure_is_transient requires one log path" >&2
    return 2
  fi

  tail -n 120 "$1" | grep -qiE "$BAKE_TRANSIENT_RE"
}
