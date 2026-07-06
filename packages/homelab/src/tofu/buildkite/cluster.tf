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
