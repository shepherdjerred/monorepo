# The Buildkite cluster the agent-stack-k8s agents register against. The agent
# token itself is intentionally NOT managed here: the provider has no documented
# import for buildkite_cluster_agent_token and its secret value can't be re-read,
# so managing it would force a rotation. It stays in 1Password (item "Buildkite
# Agent Token") and is left untouched.
resource "buildkite_cluster" "homelab" {
  name        = "Homelab"
  description = ""
}

resource "buildkite_cluster_queue" "default" {
  cluster_id  = buildkite_cluster.homelab.id
  key         = "default"
  description = "Automatically created when the cluster was created"
}

resource "buildkite_cluster_default_queue" "homelab" {
  cluster_id = buildkite_cluster.homelab.id
  queue_id   = buildkite_cluster_queue.default.id
}

# macOS queue — served by the Mac Mini agent (registered with
# `--tags queue=macos`, see packages/homelab/mac-ci/). Native Swift/Xcode
# builds that can't run in the Linux in-cluster path land here. The
# same per-cluster agent token registers macOS agents against this queue; only
# the queue tag differs from the default in-cluster agents.
resource "buildkite_cluster_queue" "macos" {
  cluster_id  = buildkite_cluster.homelab.id
  key         = "macos"
  description = "macOS agents (Mac Mini) for native Swift/Xcode builds"
}
