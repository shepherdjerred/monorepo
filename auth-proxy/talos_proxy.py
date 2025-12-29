"""
Talos API proxy addon.

Talos uses gRPC with mTLS. This is trickier because:
1. gRPC doesn't always respect HTTP_PROXY
2. mTLS requires client certificates, not just headers

Solutions:
1. Use grpc-proxy that terminates mTLS
2. Have talosctl config point to localhost proxy, proxy does mTLS to real cluster
3. Use Talos API tokens instead of mTLS where supported

This implements option 3 (API tokens) where available.
For full mTLS support, see talos_mtls_gateway.py.
"""

import os
from mitmproxy import http, ctx


class TalosAuthInjector:
    """
    Inject Talos API authentication.

    For environments using Talos API tokens (not mTLS).
    """

    def __init__(self):
        self.cluster_tokens: dict[str, str] = {}
        self._load_tokens()

    def _load_tokens(self) -> None:
        for key, value in os.environ.items():
            if key.startswith("TALOS_TOKEN_"):
                cluster = key.replace("TALOS_TOKEN_", "").lower()
                self.cluster_tokens[cluster] = value

        if default := os.environ.get("TALOS_TOKEN"):
            self.cluster_tokens["_default"] = default

    def request(self, flow: http.HTTPFlow) -> None:
        # Talos typically runs on port 50000
        if ":50000" not in flow.request.host and "talos" not in flow.request.host.lower():
            return

        for cluster, token in self.cluster_tokens.items():
            if cluster == "_default" or cluster in flow.request.host.lower():
                if "Authorization" not in flow.request.headers:
                    flow.request.headers["Authorization"] = f"Bearer {token}"
                    ctx.log.info(f"Injected Talos auth for {flow.request.host}")
                break


addons = [TalosAuthInjector()]
