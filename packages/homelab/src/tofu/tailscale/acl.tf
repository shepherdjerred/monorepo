# Tailscale tailnet policy (ACLs) as code.
#
# WHY: the tailnet previously had no restrictive policy, so every device could
# reach every other device (implicit allow-all). Once a policy file exists,
# Tailscale enforces deny-by-default and only the rules below are permitted.
# This removes blanket "every tailnet device is fully trusted" access.
#
# FIRST APPLY — READ THIS:
#   * `overwrite_existing_content = true` REPLACES whatever policy currently
#     exists in the admin console. Before the first apply, fetch the current
#     policy (`GET /api/v2/tailnet/-/acl`) and reconcile its `tagOwners` /
#     `autoApprovers` here — otherwise the Tailscale Kubernetes operator can
#     lose the ability to tag the ingress proxies it creates and *.ts.net
#     ingresses break. See packages/docs/guides/2026-06-06_tailscale-acls-runbook.md.
#   * The account owner (autogroup:admin) keeps full access below, so you cannot
#     lock yourself out. Still: run `tofu plan` AND the Tailscale policy preview,
#     and rely on the `tests` block, before `tofu apply`.
#   * Deeper per-service hardening (give each ingress its own tag so e.g. argocd
#     is reachable by admins only) requires tagging ingresses individually in
#     cdk8s (TailscaleIngress) — tracked as a follow-up in the runbook.

resource "tailscale_acl" "homelab" {
  # Required to take over the existing console-managed policy on first apply.
  # Keep true so this file stays the source of truth thereafter.
  overwrite_existing_content = true

  acl = jsonencode({
    # People. The account owner is already in autogroup:admin, so no group is
    # required for a solo tailnet. Add trusted humans here if the tailnet is shared.
    groups = {}

    # Who may assign each tag. The K8s operator's OAuth client must be able to
    # own tag:k8s (it tags the ingress/proxy devices it creates). Verify these
    # match your current console policy before the first apply.
    tagOwners = {
      "tag:k8s-operator" = ["autogroup:admin"]
      "tag:k8s"          = ["tag:k8s-operator"]
      "tag:server"       = ["autogroup:admin"]
      "tag:ci"           = ["autogroup:admin"]
      "tag:monitoring"   = ["autogroup:admin"]
      "tag:iot"          = ["autogroup:admin"]
    }

    acls = [
      # Owner / tailnet admins: full access. Prevents lockout.
      { action = "accept", src = ["autogroup:admin"], dst = ["*:*"] },

      # Other human members: ONLY the published web apps. The operator's ingress
      # proxies (tag:k8s) serve every *.ts.net service on 80/443. Non-admin
      # humans do NOT get the raw node, the Kubernetes API, or SSH. This is the
      # core change from "all devices trusted".
      { action = "accept", src = ["autogroup:members"], dst = ["tag:k8s:80,443"] },

      # The K8s operator manages the ingress/proxy devices it creates.
      { action = "accept", src = ["tag:k8s-operator"], dst = ["tag:k8s:*"] },

      # Monitoring scrapers: node/exporter/kubelet metrics + ICMP. Nothing else.
      { action = "accept", src = ["tag:monitoring"], dst = ["tag:server:9090,9093,9100,10250"] },
      { action = "accept", src = ["tag:monitoring"], proto = "icmp", dst = ["tag:server:*"] },

      # Cluster components (tag:k8s — the k8s NODE itself plus the operator's
      # ingress proxies) reach published *.ts.net ingresses on 443 OVER THE TAILNET.
      # Two critical paths depend on this and would otherwise be dropped by
      # deny-by-default (verified via /acl/validate: tag:k8s -> tag:k8s:443 = Drop
      # without this rule):
      #   * CI/tofu runs on the tag:k8s node and reaches
      #     seaweedfs-s3.tailnet-1a49.ts.net — the SeaweedFS S3 backend that stores
      #     OpenTofu state for EVERY stack. Losing this breaks `tofu apply`/`plan`
      #     for cloudflare, github, seaweedfs, AND tailscale.
      #   * ArgoCD pulls Helm charts from chartmuseum.tailnet-1a49.ts.net. Losing
      #     this breaks chart pulls / deployments.
      # Both targets are tag:k8s operator ingresses on 443. (The backend uses the
      # *.ts.net tailnet endpoint deliberately — see backend.tf — not the in-cluster
      # service, so the traffic is tailnet traffic subject to this ACL.)
      { action = "accept", src = ["tag:k8s"], dst = ["tag:k8s:443"] },

      # A dedicated CI runner tagged tag:ci (none today — CI currently runs on the
      # tag:k8s node above) would also need the tofu-state backend on 443.
      { action = "accept", src = ["tag:ci"], dst = ["tag:k8s:443"] },

      # tag:iot intentionally gets NO inbound or outbound access, and tag:ci gets
      # no *inbound* access (deny-by-default): appliances are sources only,
      # nothing reaches into them, and they cannot reach the infrastructure.
    ]

    # Let the operator self-approve any subnet routes it advertises (none today).
    autoApprovers = {
      routes   = {}
      exitNode = []
    }

    # Tailscale SSH:
    #   1. Admins -> tagged servers (e.g. future tag:server nodes).
    #   2. Preserve the tailnet default: any member may Tailscale-SSH into their
    #      OWN devices (autogroup:self) in check mode. The owner SSHes into personal
    #      devices (Steam Deck, MacBook) this way — dropping it would break that.
    #      (Windows has no Tailscale SSH server, so it uses regular sshd, already
    #      covered by the autogroup:admin -> *:* acl above.)
    ssh = [
      {
        action = "accept"
        src    = ["autogroup:admin"]
        dst    = ["tag:server"]
        users  = ["autogroup:nonroot", "root"]
      },
      {
        action = "check"
        src    = ["autogroup:members"]
        dst    = ["autogroup:self"]
        users  = ["autogroup:nonroot", "root"]
      },
    ]

    # NOTE: Funnel is intentionally NOT granted. The prior console policy granted
    # `funnel` to autogroup:members and tag:k8s by default, but nothing uses Funnel
    # (all TailscaleIngress resources are tailnet-only), so this policy drops it —
    # public internet exposure stays off by default. Add a `nodeAttrs` funnel grant
    # here if a service ever needs to be published via Funnel.

    # Assertions evaluated by Tailscale on every apply; a failing test blocks the
    # change. Tag-sourced tests are unambiguous; add user-identity tests with
    # your real login once known (see runbook).
    tests = [
      { src = "tag:k8s-operator", accept = ["tag:k8s:443"] },
      {
        src    = "tag:monitoring"
        accept = ["tag:server:9100"]
        deny   = ["tag:server:22"]
      },
      # CRITICAL: the cluster node + proxies (tag:k8s) MUST reach tailnet ingresses
      # on 443 — the tofu-state backend (seaweedfs-s3) and ArgoCD's chartmuseum.
      # A future edit that drops the tag:k8s -> tag:k8s:443 acl fails here, before
      # it can break tofu apply for every stack or ArgoCD deployments. They must
      # NOT, however, get raw node SSH/k8s-API ports.
      {
        src    = "tag:k8s"
        accept = ["tag:k8s:443"]
        deny   = ["tag:k8s:22"]
      },
      # NOTE: the "non-admin members reach only the published web apps" invariant
      # is enforced by the `autogroup:members -> tag:k8s:80,443` acl above, but it
      # CANNOT be expressed as a Tailscale ACL test: a test `src` must be a concrete
      # user or tag — the validator rejects `autogroup:members` as a test source —
      # and this solo tailnet has no non-admin member account to name instead.
      # Re-add a user-identity test here if a non-admin human is added to the tailnet.

      # CI must keep reaching the SeaweedFS S3 tofu-state backend (tag:k8s:443)
      # but nothing more — guards against accidentally dropping the tag:ci grant
      # above (which would break tofu apply for every stack) or widening it.
      {
        src    = "tag:ci"
        accept = ["tag:k8s:443"]
        deny   = ["tag:server:22", "tag:k8s:22"]
      },
    ]
  })
}
