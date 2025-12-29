"""
Kubernetes API proxy addon.

K8s auth is more complex - it can use:
- Bearer tokens
- Client certificates (mTLS)
- Exec-based auth (aws eks, gcloud, etc.)

This addon handles bearer token auth. For mTLS, see k8s_mtls_proxy.py.
"""

import os
from mitmproxy import http, ctx


class KubernetesAuthInjector:
    """Inject Kubernetes bearer token auth."""

    def __init__(self):
        # Map of cluster API endpoints to their tokens
        # Format: K8S_TOKEN_<cluster_name>=<token>
        # e.g., K8S_TOKEN_PROD=eyJhbGc...
        self.cluster_tokens: dict[str, str] = {}
        self._load_tokens()

    def _load_tokens(self) -> None:
        """Load cluster tokens from environment."""
        for key, value in os.environ.items():
            if key.startswith("K8S_TOKEN_"):
                cluster = key.replace("K8S_TOKEN_", "").lower()
                self.cluster_tokens[cluster] = value
                ctx.log.info(f"Loaded token for k8s cluster: {cluster}")

        # Also support a default token
        if default := os.environ.get("K8S_TOKEN"):
            self.cluster_tokens["_default"] = default

    def _match_cluster(self, host: str) -> str | None:
        """Match a host to a cluster name."""
        # Direct match
        for cluster in self.cluster_tokens:
            if cluster in host.lower():
                return cluster

        # Fallback to default
        if "_default" in self.cluster_tokens:
            return "_default"

        return None

    def request(self, flow: http.HTTPFlow) -> None:
        host = flow.request.host

        # Detect Kubernetes API requests
        is_k8s = (
            "/api/v1" in flow.request.path or
            "/apis/" in flow.request.path or
            host.endswith(":6443") or
            "kubernetes" in host.lower()
        )

        if not is_k8s:
            return

        cluster = self._match_cluster(host)
        if cluster and "Authorization" not in flow.request.headers:
            token = self.cluster_tokens[cluster]
            flow.request.headers["Authorization"] = f"Bearer {token}"
            ctx.log.info(f"Injected K8s auth for {host} (cluster: {cluster})")


addons = [KubernetesAuthInjector()]
