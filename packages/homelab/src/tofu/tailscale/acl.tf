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
      { action = "accept", src = ["autogroup:member"], dst = ["tag:k8s:80,443"] },

      # The K8s operator manages the ingress/proxy devices it creates.
      { action = "accept", src = ["tag:k8s-operator"], dst = ["tag:k8s:*"] },

      # Monitoring scrapers: node/exporter/kubelet metrics + ICMP. Nothing else.
      { action = "accept", src = ["tag:monitoring"], dst = ["tag:server:9090,9093,9100,10250"] },
      { action = "accept", src = ["tag:monitoring"], proto = "icmp", dst = ["tag:server:*"] },

      # CI runners (tag:ci) must reach the SeaweedFS S3 backend that stores the
      # OpenTofu state for every stack (cloudflare, github, seaweedfs, and this
      # tailscale stack). That backend, seaweedfs-s3.tailnet-1a49.ts.net, is
      # published by the Tailscale operator's ingress proxy (tag:k8s) on 443 —
      # NOT a tag:server node — so the grant must target tag:k8s:443. Without it,
      # deny-by-default would cut CI off from tofu state and break apply for ALL
      # stacks, not just this one.
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

    # Tailscale SSH: admins only, to tagged servers.
    ssh = [
      {
        action = "accept"
        src    = ["autogroup:admin"]
        dst    = ["tag:server"]
        users  = ["autogroup:nonroot", "root"]
      },
    ]

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
      # Core security invariant: non-admin members reach only the published web
      # apps on tag:k8s (80/443) — never SSH, the Kubernetes API, or raw server
      # ports. A future edit that widens the autogroup:member rule fails here.
      {
        src    = "autogroup:member"
        accept = ["tag:k8s:443"]
        deny   = ["tag:k8s:22", "tag:server:22"]
      },
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
