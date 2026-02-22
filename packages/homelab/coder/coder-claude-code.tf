terraform {
  required_providers {
    coder = {
      source  = "coder/coder"
      version = ">= 2.13"
    }
    kubernetes = {
      source = "hashicorp/kubernetes"
    }
    envbuilder = {
      source = "coder/envbuilder"
    }
  }
}

provider "coder" {}
provider "kubernetes" {
  # Authenticate via ~/.kube/config or a Coder-specific ServiceAccount, depending on admin preferences
  config_path = var.use_kubeconfig == true ? "~/.kube/config" : null
}
provider "envbuilder" {}

data "coder_provisioner" "me" {}
data "coder_workspace" "me" {}
data "coder_workspace_owner" "me" {}

# Task data source for AI task prompts
data "coder_task" "me" {}

# AI Task resource for Coder Tasks UI
resource "coder_ai_task" "task" {
  app_id = module.claude-code.task_app_id
}

variable "use_kubeconfig" {
  type        = bool
  description = <<-EOF
  Use host kubeconfig? (true/false)

  Set this to false if the Coder host is itself running as a Pod on the same
  Kubernetes cluster as you are deploying workspaces to.

  Set this to true if the Coder host is running outside the Kubernetes cluster
  for workspaces.  A valid "~/.kube/config" must be present on the Coder host.
  EOF
  default     = false
}

variable "namespace" {
  type        = string
  default     = "default"
  description = "The Kubernetes namespace to create workspaces in (must exist prior to creating workspaces)."
}

variable "cache_repo" {
  default     = ""
  description = "Use a container registry as a cache to speed up builds."
  type        = string
}

variable "insecure_cache_repo" {
  default     = false
  description = "Enable this option if your cache registry does not serve HTTPS."
  type        = bool
}

variable "anthropic_api_key" {
  type        = string
  description = "Anthropic API key for Claude Code. Generate one at: https://console.anthropic.com/settings/keys"
  sensitive   = true
}

data "coder_parameter" "workspaces_volume_size" {
  name         = "workspaces_volume_size"
  display_name = "Workspaces volume size"
  description  = "Size of the `/workspaces` volume (GiB)."
  default      = "20"
  type         = "number"
  icon         = "/emojis/1f4be.png"
  mutable      = false
  validation {
    min = 1
    max = 128
  }
  order = 4
}

data "coder_parameter" "enable_mcp_secrets" {
  name         = "enable_mcp_secrets"
  display_name = "Enable MCP Server Secrets"
  description  = "Mount secrets from 1Password for MCP servers (Home Assistant, PagerDuty, Grafana, GitHub)."
  default      = "false"
  type         = "bool"
  icon         = "/icon/claude.svg"
  mutable      = true
  order        = 3
}

data "coder_parameter" "repo" {
  description  = "Select a repository to automatically clone and start working with a devcontainer."
  display_name = "Repository (auto)"
  mutable      = true
  name         = "repo"
  order        = 5
  type         = "string"
  default = "https://github.com/shepherdjerred/scout-for-lol"
}

data "coder_parameter" "fallback_image" {
  default      = "ubuntu:jammy"
  description  = "This image runs if the devcontainer fails to build."
  display_name = "Fallback Image"
  mutable      = true
  name         = "fallback_image"
  order        = 6
}

data "coder_parameter" "devcontainer_builder" {
  description  = <<-EOF
Image that will build the devcontainer.
We highly recommend using a specific release as the `:latest` tag will change.
Find the latest version of Envbuilder here: https://github.com/coder/envbuilder/pkgs/container/envbuilder
EOF
  display_name = "Devcontainer Builder"
  mutable      = true
  name         = "devcontainer_builder"
  default      = "ghcr.io/coder/envbuilder:latest"
  order        = 7
}

data "coder_parameter" "claude_model" {
  name         = "claude_model"
  display_name = "Claude Model"
  description  = "The Claude model to use for code generation."
  default      = "sonnet"
  type         = "string"
  icon         = "/icon/claude.svg"
  mutable      = true
  option {
    name  = "Claude Sonnet"
    value = "sonnet"
  }
  option {
    name  = "Claude Opus"
    value = "opus"
  }
  option {
    name  = "Claude Haiku"
    value = "haiku"
  }
  order = 1
}

data "coder_parameter" "permission_mode" {
  name         = "permission_mode"
  display_name = "Permission Mode"
  description  = "Controls how Claude Code handles tool permissions."
  default      = "default"
  type         = "string"
  icon         = "/icon/claude.svg"
  mutable      = true
  option {
    name  = "Default (default)"
    value = "default"
  }
  option {
    name  = "Plan Mode"
    value = "plan"
  }
  option {
    name  = "Full Auto (bypassPermissions)"
    value = "bypassPermissions"
  }
  order = 2
}

# Home Assistant MCP token
resource "kubernetes_manifest" "onepassword_item_homeassistant" {
  count = data.coder_parameter.enable_mcp_secrets.value == "true" ? 1 : 0
  manifest = {
    apiVersion = "onepassword.com/v1"
    kind       = "OnePasswordItem"
    metadata = {
      name      = "coder-${lower(data.coder_workspace.me.id)}-homeassistant-mcp"
      namespace = var.namespace
    }
    spec = {
      itemPath = "vaults/v64ocnykdqju4ui6j6pua56xw4/items/x634rhbmhjbawuu4bv3ey5o53q"
    }
  }
}

# PagerDuty MCP token
resource "kubernetes_manifest" "onepassword_item_pagerduty" {
  count = data.coder_parameter.enable_mcp_secrets.value == "true" ? 1 : 0
  manifest = {
    apiVersion = "onepassword.com/v1"
    kind       = "OnePasswordItem"
    metadata = {
      name      = "coder-${lower(data.coder_workspace.me.id)}-pagerduty-mcp"
      namespace = var.namespace
    }
    spec = {
      itemPath = "vaults/v64ocnykdqju4ui6j6pua56xw4/items/yio3tx4wkvysvy5umdrqh7fe2e"
    }
  }
}

# Grafana MCP token
resource "kubernetes_manifest" "onepassword_item_grafana" {
  count = data.coder_parameter.enable_mcp_secrets.value == "true" ? 1 : 0
  manifest = {
    apiVersion = "onepassword.com/v1"
    kind       = "OnePasswordItem"
    metadata = {
      name      = "coder-${lower(data.coder_workspace.me.id)}-grafana-mcp"
      namespace = var.namespace
    }
    spec = {
      itemPath = "vaults/v64ocnykdqju4ui6j6pua56xw4/items/w5y6wldczvojkh3yxe5zadkpvi"
    }
  }
}

# GitHub MCP token
resource "kubernetes_manifest" "onepassword_item_github" {
  count = data.coder_parameter.enable_mcp_secrets.value == "true" ? 1 : 0
  manifest = {
    apiVersion = "onepassword.com/v1"
    kind       = "OnePasswordItem"
    metadata = {
      name      = "coder-${lower(data.coder_workspace.me.id)}-github-mcp"
      namespace = var.namespace
    }
    spec = {
      itemPath = "vaults/v64ocnykdqju4ui6j6pua56xw4/items/kjzy27cw4ialemerahutnxis3a"
    }
  }
}

locals {
  deployment_name            = "coder-${lower(data.coder_workspace.me.id)}"
  devcontainer_builder_image = data.coder_parameter.devcontainer_builder.value
  git_author_name            = coalesce(data.coder_workspace_owner.me.full_name, data.coder_workspace_owner.me.name)
  git_author_email           = data.coder_workspace_owner.me.email
  repo_url                   = data.coder_parameter.repo.value

  # The envbuilder provider requires a key-value map of environment variables.
  envbuilder_env = {
    "CODER_AGENT_TOKEN" : coder_agent.main.token,
    # Use the docker gateway if the access URL is 127.0.0.1
    "CODER_AGENT_URL" : replace(data.coder_workspace.me.access_url, "/localhost|127\\.0\\.0\\.1/", "host.docker.internal"),
    # ENVBUILDER_GIT_URL and ENVBUILDER_CACHE_REPO will be overridden by the provider
    # if the cache repo is enabled.
    "ENVBUILDER_GIT_URL" : var.cache_repo == "" ? local.repo_url : "",
    # Use the docker gateway if the access URL is 127.0.0.1
    "ENVBUILDER_INIT_SCRIPT" : replace(coder_agent.main.init_script, "/localhost|127\\.0\\.0\\.1/", "host.docker.internal"),
    "ENVBUILDER_FALLBACK_IMAGE" : data.coder_parameter.fallback_image.value,
    "ENVBUILDER_PUSH_IMAGE" : var.cache_repo == "" ? "" : "true",
    # Force the built container to run as user 1000 (non-root) without modifying devcontainer.json
    # The setup script ensures a user with UID 1000 exists and sets it as the target user
    "ENVBUILDER_SETUP_SCRIPT" : <<-SCRIPT
      if ! id -u 1000 >/dev/null 2>&1; then
        useradd -m -u 1000 -s /bin/bash coder || true
      fi
      echo "TARGET_USER=1000" >> $ENVBUILDER_ENV
    SCRIPT
  }

  # MCP configuration for Claude Code
  mcp_config = data.coder_parameter.enable_mcp_secrets.value == "true" ? jsonencode({
    mcpServers = {
      "home-assistant" = {
        command = "npx"
        args    = ["-y", "@homeassistant/mcp-server"]
        env = {
          API_ACCESS_TOKEN = "$${API_ACCESS_TOKEN}"
        }
      }
      "pagerduty" = {
        command = "npx"
        args    = ["-y", "@pagerduty/mcp-server"]
        env = {
          PAGERDUTY_USER_API_KEY = "$${PAGERDUTY_USER_API_KEY}"
        }
      }
      "grafana" = {
        command = "npx"
        args    = ["-y", "@grafana/mcp-server"]
        env = {
          GRAFANA_SERVICE_ACCOUNT_TOKEN = "$${GRAFANA_SERVICE_ACCOUNT_TOKEN}"
        }
      }
      "github" = {
        command = "npx"
        args    = ["-y", "@github/mcp-server"]
        env = {
          GITHUB_PERSONAL_ACCESS_TOKEN = "$${GITHUB_PERSONAL_ACCESS_TOKEN}"
        }
      }
    }
  }) : "{}"
}

# Check for the presence of a prebuilt image in the cache repo
# that we can use instead.
resource "envbuilder_cached_image" "cached" {
  count         = var.cache_repo == "" ? 0 : data.coder_workspace.me.start_count
  builder_image = local.devcontainer_builder_image
  git_url       = local.repo_url
  cache_repo    = var.cache_repo
  extra_env     = local.envbuilder_env
  insecure      = var.insecure_cache_repo
}

resource "kubernetes_persistent_volume_claim" "workspaces" {
  metadata {
    name      = "coder-${lower(data.coder_workspace.me.id)}-workspaces"
    namespace = var.namespace
    labels = {
      "app.kubernetes.io/name"     = "coder-${lower(data.coder_workspace.me.id)}-workspaces"
      "app.kubernetes.io/instance" = "coder-${lower(data.coder_workspace.me.id)}-workspaces"
      "app.kubernetes.io/part-of"  = "coder"
      "com.coder.resource"         = "true"
      "com.coder.workspace.id"     = data.coder_workspace.me.id
      "com.coder.workspace.name"   = data.coder_workspace.me.name
      "com.coder.user.id"          = data.coder_workspace_owner.me.id
      "com.coder.user.username"    = data.coder_workspace_owner.me.name
    }
    annotations = {
      "com.coder.user.email" = data.coder_workspace_owner.me.email
    }
  }
  wait_until_bound = false
  spec {
    storage_class_name = "zfs-ssd"
    access_modes       = ["ReadWriteOnce"]
    resources {
      requests = {
        storage = "${data.coder_parameter.workspaces_volume_size.value}Gi"
      }
    }
  }
}

resource "kubernetes_deployment" "main" {
  depends_on = [
    kubernetes_persistent_volume_claim.workspaces
  ]
  wait_for_rollout = false
  metadata {
    name      = local.deployment_name
    namespace = var.namespace
    labels = {
      "app.kubernetes.io/name"     = "coder-workspace"
      "app.kubernetes.io/instance" = local.deployment_name
      "app.kubernetes.io/part-of"  = "coder"
      "com.coder.resource"         = "true"
      "com.coder.workspace.id"     = data.coder_workspace.me.id
      "com.coder.workspace.name"   = data.coder_workspace.me.name
      "com.coder.user.id"          = data.coder_workspace_owner.me.id
      "com.coder.user.username"    = data.coder_workspace_owner.me.name
    }
    annotations = {
      "com.coder.user.email" = data.coder_workspace_owner.me.email
    }
  }

  spec {
    replicas = data.coder_workspace.me.start_count
    selector {
      match_labels = {
        "app.kubernetes.io/name" = "coder-workspace"
      }
    }
    strategy {
      type = "Recreate"
    }

    template {
      metadata {
        labels = {
          "app.kubernetes.io/name" = "coder-workspace"
        }
      }
      spec {
        security_context {
          fs_group = 1000
        }

        container {
          name              = "dev"
          image             = var.cache_repo == "" ? local.devcontainer_builder_image : envbuilder_cached_image.cached.0.image
          image_pull_policy = "Always"
          # Envbuilder runs as root to build containers
          # The built devcontainer should configure security in devcontainer.json
          security_context {}

          # Set the environment using cached_image.cached.0.env if the cache repo is enabled.
          # Otherwise, use the local.envbuilder_env.
          dynamic "env" {
            for_each = nonsensitive(var.cache_repo == "" ? local.envbuilder_env : envbuilder_cached_image.cached.0.env_map)
            content {
              name  = env.key
              value = env.value
            }
          }

          # Configure Docker to use the DinD sidecar
          env {
            name  = "DOCKER_HOST"
            value = "tcp://localhost:2375"
          }

          # Mount 1Password secrets for MCP servers as environment variables (if enabled)
          dynamic "env" {
            for_each = data.coder_parameter.enable_mcp_secrets.value == "true" ? [
              {
                name        = "API_ACCESS_TOKEN"
                secret_name = kubernetes_manifest.onepassword_item_homeassistant[0].manifest.metadata.name
              },
              {
                name        = "PAGERDUTY_USER_API_KEY"
                secret_name = kubernetes_manifest.onepassword_item_pagerduty[0].manifest.metadata.name
              },
              {
                name        = "GRAFANA_SERVICE_ACCOUNT_TOKEN"
                secret_name = kubernetes_manifest.onepassword_item_grafana[0].manifest.metadata.name
              },
              {
                name        = "GITHUB_PERSONAL_ACCESS_TOKEN"
                secret_name = kubernetes_manifest.onepassword_item_github[0].manifest.metadata.name
              }
            ] : []
            content {
              name = env.value.name
              value_from {
                secret_key_ref {
                  name = env.value.secret_name
                  key  = "password"
                }
              }
            }
          }

          resources {
            requests = {
              "cpu"    = "250m"
              "memory" = "512Mi"
            }
          }
          volume_mount {
            mount_path = "/workspaces"
            name       = "workspaces"
            read_only  = false
          }
        }

        # Docker-in-Docker sidecar container
        container {
          name  = "dind"
          image = "docker:dind@sha256:8bcbad4b45f0bff9d3e809d85a7ac589390f0be8acbc526850c998c35c1243fd"
          security_context {
            privileged = true
          }
          env {
            name  = "DOCKER_TLS_CERTDIR"
            value = ""
          }
          env {
            name  = "DOCKER_HOST"
            value = "tcp://0.0.0.0:2375"
          }
          resources {
            requests = {
              "cpu"    = "500m"
              "memory" = "1Gi"
            }
          }
          volume_mount {
            mount_path = "/var/lib/docker"
            name       = "docker-storage"
          }
        }

        volume {
          name = "workspaces"
          persistent_volume_claim {
            claim_name = kubernetes_persistent_volume_claim.workspaces.metadata.0.name
            read_only  = false
          }
        }

        volume {
          name = "docker-storage"
          empty_dir {}
        }
      }
    }
  }
}

resource "coder_agent" "main" {
  arch           = data.coder_provisioner.me.arch
  os             = "linux"
  startup_script = <<-EOT
    set -e

    # Add any commands that should be executed at workspace startup (e.g install requirements, start a program, etc) here
  EOT
  dir            = "/workspaces"

  metadata {
    display_name = "CPU Usage"
    key          = "0_cpu_usage"
    script       = "coder stat cpu"
    interval     = 10
    timeout      = 1
  }

  metadata {
    display_name = "RAM Usage"
    key          = "1_ram_usage"
    script       = "coder stat mem"
    interval     = 10
    timeout      = 1
  }

  metadata {
    display_name = "Workspaces Disk"
    key          = "3_workspaces_disk"
    script       = "coder stat disk --path /workspaces"
    interval     = 60
    timeout      = 1
  }

  metadata {
    display_name = "CPU Usage (Host)"
    key          = "4_cpu_usage_host"
    script       = "coder stat cpu --host"
    interval     = 10
    timeout      = 1
  }

  metadata {
    display_name = "Memory Usage (Host)"
    key          = "5_mem_usage_host"
    script       = "coder stat mem --host"
    interval     = 10
    timeout      = 1
  }

  metadata {
    display_name = "Load Average (Host)"
    key          = "6_load_host"
    script       = <<EOT
      echo "`cat /proc/loadavg | awk '{ print $1 }'` `nproc`" | awk '{ printf "%0.2f", $1/$2 }'
    EOT
    interval     = 60
    timeout      = 1
  }

  metadata {
    display_name = "Swap Usage (Host)"
    key          = "7_swap_host"
    script       = <<EOT
      free -b | awk '/^Swap/ { printf("%.1f/%.1f", $3/1024.0/1024.0/1024.0, $2/1024.0/1024.0/1024.0) }'
    EOT
    interval     = 10
    timeout      = 1
  }
}

# Claude Code module for AI-powered coding
module "claude-code" {
  source   = "registry.coder.com/coder/claude-code/coder"
  version  = "4.6.0"
  agent_id = coder_agent.main.id
  workdir  = "/workspaces"

  claude_api_key = var.anthropic_api_key

  ai_prompt       = data.coder_task.me.prompt
  model           = data.coder_parameter.claude_model.value
  permission_mode = data.coder_parameter.permission_mode.value

  mcp = local.mcp_config
}

resource "coder_metadata" "container_info" {
  count       = data.coder_workspace.me.start_count
  resource_id = coder_agent.main.id
  item {
    key   = "agent"
    value = "Claude Code"
  }
  item {
    key   = "model"
    value = data.coder_parameter.claude_model.value
  }
  item {
    key   = "workspace image"
    value = var.cache_repo == "" ? local.devcontainer_builder_image : envbuilder_cached_image.cached.0.image
  }
  item {
    key   = "git url"
    value = local.repo_url
  }
  item {
    key   = "cache repo"
    value = var.cache_repo == "" ? "not enabled" : var.cache_repo
  }
}
