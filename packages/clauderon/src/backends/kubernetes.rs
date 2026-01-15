use async_trait::async_trait;
use k8s_openapi::api::core::v1::{
    ConfigMap, Container, EnvVar, HostAlias, Namespace, PersistentVolumeClaim,
    PersistentVolumeClaimSpec, Pod, PodSecurityContext, PodSpec, ResourceRequirements,
    SecurityContext, Volume, VolumeMount, VolumeResourceRequirements,
};
use k8s_openapi::apimachinery::pkg::api::resource::Quantity;
use k8s_openapi::apimachinery::pkg::apis::meta::v1::ObjectMeta;
use kube::Client;
use kube::api::{Api, DeleteParams, LogParams, PostParams};
use std::collections::BTreeMap;
use std::path::Path;
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

use super::kubernetes_config::{KubernetesConfig, KubernetesProxyConfig};
use super::traits::{CreateOptions, ExecutionBackend};
use crate::core::AgentType;
use crate::plugins::PluginDiscovery;
use crate::proxy::{dummy_auth_json_string, dummy_config_toml};

/// Sanitize git config value to prevent environment variable injection
///
/// Removes all control characters (including newlines, tabs, etc.) that could be used for injection attacks
fn sanitize_git_config_value(value: &str) -> String {
    value.chars().filter(|c| !c.is_control()).collect()
}

/// Kubernetes backend for running Claude Code sessions in pods
pub struct KubernetesBackend {
    config: KubernetesConfig,
    proxy_config: Option<KubernetesProxyConfig>,
    client: Client,
}

impl KubernetesBackend {
    /// Create a new Kubernetes backend
    ///
    /// # Errors
    ///
    /// Returns an error if the Kubernetes client cannot be created
    pub async fn new(config: KubernetesConfig) -> anyhow::Result<Self> {
        let client = Client::try_default().await?;
        Ok(Self {
            config,
            proxy_config: None,
            client,
        })
    }

    /// Create a new Kubernetes backend with proxy configuration
    ///
    /// # Errors
    ///
    /// Returns an error if the Kubernetes client cannot be created
    pub async fn with_proxy(
        config: KubernetesConfig,
        proxy_config: KubernetesProxyConfig,
    ) -> anyhow::Result<Self> {
        let client = Client::try_default().await?;
        Ok(Self {
            config,
            proxy_config: Some(proxy_config),
            client,
        })
    }

    /// Generate pod name from session name
    fn pod_name(session_name: &str) -> String {
        format!("clauderon-{session_name}")
    }

    /// Detect git remote URL from a git repository
    async fn detect_git_remote(workdir: &Path, remote_name: &str) -> anyhow::Result<String> {
        let output = Command::new("git")
            .args(["config", "--get", &format!("remote.{remote_name}.url")])
            .current_dir(workdir)
            .output()
            .await?;

        if !output.status.success() {
            anyhow::bail!(
                "No git remote '{}' found in {}. Initialize a git repository with a remote first.",
                remote_name,
                workdir.display()
            );
        }

        let url = String::from_utf8(output.stdout)?.trim().to_string();
        if url.is_empty() {
            anyhow::bail!("Git remote URL is empty");
        }

        Ok(url)
    }

    /// Read git user configuration from the host system
    ///
    /// Values are sanitized to prevent environment variable injection
    async fn read_git_user_config() -> (Option<String>, Option<String>) {
        let name = Command::new("git")
            .args(["config", "--get", "user.name"])
            .output()
            .await
            .ok()
            .and_then(|output| {
                if output.status.success() {
                    String::from_utf8(output.stdout)
                        .ok()
                        .map(|s| sanitize_git_config_value(s.trim()))
                        .filter(|s| !s.is_empty())
                } else {
                    None
                }
            });

        let email = Command::new("git")
            .args(["config", "--get", "user.email"])
            .output()
            .await
            .ok()
            .and_then(|output| {
                if output.status.success() {
                    String::from_utf8(output.stdout)
                        .ok()
                        .map(|s| sanitize_git_config_value(s.trim()))
                        .filter(|s| !s.is_empty())
                } else {
                    None
                }
            });

        (name, email)
    }

    /// Ensure the namespace and service account exist
    async fn ensure_namespace_exists(&self) -> anyhow::Result<()> {
        let namespaces: Api<Namespace> = Api::all(self.client.clone());

        match namespaces.get(&self.config.namespace).await {
            Ok(_) => (),
            Err(kube::Error::Api(err)) if err.code == 404 => {
                anyhow::bail!(
                    "Namespace '{}' does not exist. Create it with: kubectl create namespace {}",
                    self.config.namespace,
                    self.config.namespace
                );
            }
            Err(e) => return Err(e.into()),
        }

        // Validate service account exists
        use k8s_openapi::api::core::v1::ServiceAccount;
        let service_accounts: Api<ServiceAccount> =
            Api::namespaced(self.client.clone(), &self.config.namespace);

        match service_accounts.get(&self.config.service_account).await {
            Ok(_) => Ok(()),
            Err(kube::Error::Api(err)) if err.code == 404 => {
                anyhow::bail!(
                    "ServiceAccount '{}' does not exist in namespace '{}'. Create it with: kubectl create serviceaccount {} -n {}",
                    self.config.service_account,
                    self.config.namespace,
                    self.config.service_account,
                    self.config.namespace
                );
            }
            Err(e) => Err(e.into()),
        }
    }

    /// Ensure shared cache PVCs exist (cargo and sccache)
    async fn ensure_shared_pvcs_exist(&self) -> anyhow::Result<()> {
        let pvcs: Api<PersistentVolumeClaim> =
            Api::namespaced(self.client.clone(), &self.config.namespace);

        // Create cargo cache PVC if it doesn't exist
        if pvcs.get("clauderon-cargo-cache").await.is_err() {
            self.create_shared_pvc("clauderon-cargo-cache", &self.config.cargo_cache_size)
                .await?;
            tracing::info!("Created shared cargo cache PVC");
        }

        // Create sccache PVC if it doesn't exist
        if pvcs.get("clauderon-sccache").await.is_err() {
            self.create_shared_pvc("clauderon-sccache", &self.config.sccache_cache_size)
                .await?;
            tracing::info!("Created shared sccache PVC");
        }

        // Create uploads PVC for image attachments (shared across sessions)
        // Unlike workspace PVCs which are per-session, uploads are shared with session-id subdirectories
        if pvcs.get("clauderon-uploads").await.is_err() {
            self.create_shared_pvc("clauderon-uploads", "10Gi").await?;
            tracing::info!("Created shared uploads PVC");
        }

        Ok(())
    }

    /// Create a shared PVC for caching
    ///
    /// Tries ReadWriteMany first, falls back to ReadWriteOnce if RWX is not available
    async fn create_shared_pvc(&self, name: &str, size: &str) -> anyhow::Result<()> {
        let pvcs: Api<PersistentVolumeClaim> =
            Api::namespaced(self.client.clone(), &self.config.namespace);

        let mut resources = BTreeMap::new();
        resources.insert("storage".to_string(), Quantity(size.to_string()));

        // Determine access mode based on config
        let access_modes = if self.config.use_rwo_cache {
            vec!["ReadWriteOnce".to_string()]
        } else {
            vec!["ReadWriteMany".to_string()]
        };

        let pvc = PersistentVolumeClaim {
            metadata: ObjectMeta {
                name: Some(name.to_string()),
                namespace: Some(self.config.namespace.clone()),
                labels: Some({
                    let mut labels = BTreeMap::new();
                    labels.insert("clauderon.io/managed".to_string(), "true".to_string());
                    labels.insert("clauderon.io/type".to_string(), "cache".to_string());
                    labels
                }),
                ..Default::default()
            },
            spec: Some(PersistentVolumeClaimSpec {
                access_modes: Some(access_modes.clone()),
                storage_class_name: self.config.storage_class.clone(),
                resources: Some(VolumeResourceRequirements {
                    requests: Some(resources.clone()),
                    ..Default::default()
                }),
                ..Default::default()
            }),
            ..Default::default()
        };

        // Try to create PVC
        match pvcs.create(&PostParams::default(), &pvc).await {
            Ok(_) => {
                tracing::info!(
                    name = name,
                    access_mode = ?access_modes[0],
                    "Created shared cache PVC"
                );
                if access_modes[0] == "ReadWriteOnce" {
                    tracing::warn!(
                        name = name,
                        "Using ReadWriteOnce for cache PVC. Only one pod can mount this cache at a time. Concurrent sessions may fail to start."
                    );
                }
                Ok(())
            }
            Err(e) if !self.config.use_rwo_cache && Self::is_access_mode_error(&e) => {
                // Fallback to RWO if RWX not supported
                tracing::warn!(
                    name = name,
                    error = %e,
                    "ReadWriteMany not supported by storage class, falling back to ReadWriteOnce"
                );
                tracing::warn!(
                    name = name,
                    "Using ReadWriteOnce for cache PVC. Only one pod can mount this cache at a time. Concurrent sessions may fail to start."
                );

                let mut rwo_labels = BTreeMap::new();
                rwo_labels.insert("clauderon.io/managed".to_string(), "true".to_string());
                rwo_labels.insert("clauderon.io/type".to_string(), "cache".to_string());
                rwo_labels.insert(
                    "clauderon.io/access-mode".to_string(),
                    "rwo-fallback".to_string(),
                );

                let rwo_pvc = PersistentVolumeClaim {
                    metadata: ObjectMeta {
                        name: Some(name.to_string()),
                        namespace: Some(self.config.namespace.clone()),
                        labels: Some(rwo_labels),
                        ..Default::default()
                    },
                    spec: Some(PersistentVolumeClaimSpec {
                        access_modes: Some(vec!["ReadWriteOnce".to_string()]),
                        storage_class_name: self.config.storage_class.clone(),
                        resources: Some(VolumeResourceRequirements {
                            requests: Some(resources),
                            ..Default::default()
                        }),
                        ..Default::default()
                    }),
                    ..Default::default()
                };

                pvcs.create(&PostParams::default(), &rwo_pvc).await?;
                tracing::info!(
                    name = name,
                    "Created shared cache PVC with ReadWriteOnce (fallback)"
                );
                Ok(())
            }
            Err(e) => Err(e.into()),
        }
    }

    /// Check if error is related to unsupported access mode
    ///
    /// Note: This is still somewhat fragile as it relies on error message content,
    /// but Kubernetes API errors don't always provide structured error codes for
    /// storage class capabilities.
    fn is_access_mode_error(e: &kube::Error) -> bool {
        match e {
            kube::Error::Api(api_err) => {
                // Check error message for access mode issues
                let msg = api_err.message.to_lowercase();
                (msg.contains("access mode")
                    || msg.contains("accessmode")
                    || msg.contains("readwritemany")
                    || msg.contains("rwx"))
                    && (msg.contains("not supported")
                        || msg.contains("unsupported")
                        || msg.contains("invalid"))
            }
            _ => false,
        }
    }

    /// Create a workspace PVC for a specific session
    async fn create_workspace_pvc(&self, pod_name: &str, session_id: &str) -> anyhow::Result<()> {
        let pvcs: Api<PersistentVolumeClaim> =
            Api::namespaced(self.client.clone(), &self.config.namespace);

        let pvc_name = format!("{pod_name}-workspace");
        let mut resources = BTreeMap::new();
        resources.insert(
            "storage".to_string(),
            Quantity(self.config.workspace_pvc_size.clone()),
        );

        let pvc = PersistentVolumeClaim {
            metadata: ObjectMeta {
                name: Some(pvc_name),
                namespace: Some(self.config.namespace.clone()),
                labels: Some({
                    let mut labels = BTreeMap::new();
                    labels.insert("clauderon.io/managed".to_string(), "true".to_string());
                    labels.insert("clauderon.io/type".to_string(), "workspace".to_string());
                    labels.insert(
                        "clauderon.io/session-id".to_string(),
                        session_id.to_string(),
                    );
                    labels
                }),
                ..Default::default()
            },
            spec: Some(PersistentVolumeClaimSpec {
                access_modes: Some(vec!["ReadWriteOnce".to_string()]),
                storage_class_name: self.config.storage_class.clone(),
                resources: Some(VolumeResourceRequirements {
                    requests: Some(resources),
                    ..Default::default()
                }),
                ..Default::default()
            }),
            ..Default::default()
        };

        pvcs.create(&PostParams::default(), &pvc).await?;
        Ok(())
    }

    /// Create ConfigMap for Claude configuration
    async fn create_claude_config_configmap(&self, pod_name: &str) -> anyhow::Result<()> {
        let cms: Api<ConfigMap> = Api::namespaced(self.client.clone(), &self.config.namespace);

        // Discover plugins from host (where clauderon server runs)
        // Note: Plugins cannot be mounted in Kubernetes pods without PersistentVolumes
        let plugin_discovery = PluginDiscovery::new(
            dirs::home_dir()
                .unwrap_or_else(|| std::path::PathBuf::from("/tmp"))
                .join(".claude"),
        );

        if let Ok(plugin_manifest) = plugin_discovery.discover_plugins() {
            if !plugin_manifest.installed_plugins.is_empty() {
                tracing::warn!(
                    plugin_count = plugin_manifest.installed_plugins.len(),
                    "Plugins discovered but cannot be mounted in Kubernetes pods. \
                     Plugin functionality will be limited. Future enhancement: use PersistentVolumes for plugin support."
                );
            }
        }

        // Create minimal .claude.json config
        let claude_config = serde_json::json!({
            "version": "1.0",
            "managed": true
        });

        let mut data = BTreeMap::new();
        data.insert("claude.json".to_string(), claude_config.to_string());

        let cm = ConfigMap {
            metadata: ObjectMeta {
                name: Some(format!("{pod_name}-config")),
                namespace: Some(self.config.namespace.clone()),
                labels: Some({
                    let mut labels = BTreeMap::new();
                    labels.insert("clauderon.io/managed".to_string(), "true".to_string());
                    labels
                }),
                ..Default::default()
            },
            data: Some(data),
            ..Default::default()
        };

        cms.create(&PostParams::default(), &cm).await?;
        Ok(())
    }

    /// Create ConfigMap for Codex dummy auth/config (if proxy enabled)
    async fn create_codex_config_configmap(&self, pod_name: &str) -> anyhow::Result<()> {
        let Some(ref proxy_config) = self.proxy_config else {
            return Ok(());
        };

        if !proxy_config.enabled {
            return Ok(());
        }

        let cms: Api<ConfigMap> = Api::namespaced(self.client.clone(), &self.config.namespace);
        let codex_dir = proxy_config.clauderon_dir.join("codex");
        let auth_path = codex_dir.join("auth.json");
        let config_path = codex_dir.join("config.toml");

        let auth_json = match std::fs::read_to_string(&auth_path) {
            Ok(contents) => contents,
            Err(_) => dummy_auth_json_string(None)?,
        };
        let config_toml = std::fs::read_to_string(&config_path)
            .unwrap_or_else(|_| dummy_config_toml().to_string());

        let mut data = BTreeMap::new();
        data.insert("auth.json".to_string(), auth_json);
        data.insert("config.toml".to_string(), config_toml);

        let cm = ConfigMap {
            metadata: ObjectMeta {
                name: Some(format!("{pod_name}-codex-config")),
                namespace: Some(self.config.namespace.clone()),
                labels: Some({
                    let mut labels = BTreeMap::new();
                    labels.insert("clauderon.io/managed".to_string(), "true".to_string());
                    labels
                }),
                ..Default::default()
            },
            data: Some(data),
            ..Default::default()
        };

        cms.create(&PostParams::default(), &cm).await?;
        Ok(())
    }

    /// Create ConfigMap for proxy CA certificate (if proxy enabled)
    async fn create_proxy_configmap(&self) -> anyhow::Result<()> {
        let Some(ref proxy_config) = self.proxy_config else {
            return Ok(());
        };

        if !proxy_config.enabled {
            return Ok(());
        }

        let cms: Api<ConfigMap> = Api::namespaced(self.client.clone(), &self.config.namespace);

        // Check if ConfigMap already exists
        if cms.get("clauderon-proxy-ca").await.is_ok() {
            return Ok(());
        }

        let ca_cert_path = proxy_config.clauderon_dir.join("proxy-ca.pem");
        if !ca_cert_path.exists() {
            anyhow::bail!(
                "Proxy CA certificate not found at {}",
                ca_cert_path.display()
            );
        }

        let ca_cert = std::fs::read_to_string(&ca_cert_path)?;

        let mut data = BTreeMap::new();
        data.insert("proxy-ca.pem".to_string(), ca_cert);

        let cm = ConfigMap {
            metadata: ObjectMeta {
                name: Some("clauderon-proxy-ca".to_string()),
                namespace: Some(self.config.namespace.clone()),
                labels: Some({
                    let mut labels = BTreeMap::new();
                    labels.insert("clauderon.io/managed".to_string(), "true".to_string());
                    labels
                }),
                ..Default::default()
            },
            data: Some(data),
            ..Default::default()
        };

        cms.create(&PostParams::default(), &cm).await?;
        Ok(())
    }

    /// Build init container for git clone
    fn build_init_container(
        &self,
        git_remote_url: &str,
        branch_name: &str,
        git_user_name: Option<&str>,
        git_user_email: Option<&str>,
    ) -> Container {
        let mut env = vec![
            EnvVar {
                name: "GIT_REMOTE_URL".to_string(),
                value: Some(git_remote_url.to_string()),
                ..Default::default()
            },
            EnvVar {
                name: "BRANCH_NAME".to_string(),
                value: Some(branch_name.to_string()),
                ..Default::default()
            },
        ];

        if let Some(name) = git_user_name {
            env.push(EnvVar {
                name: "GIT_AUTHOR_NAME".to_string(),
                value: Some(name.to_string()),
                ..Default::default()
            });
        }

        if let Some(email) = git_user_email {
            env.push(EnvVar {
                name: "GIT_AUTHOR_EMAIL".to_string(),
                value: Some(email.to_string()),
                ..Default::default()
            });
        }

        let script = r#"
set -e
cd /workspace

# Clone repo if not already cloned
if [ ! -d ".git" ]; then
  git clone ${GIT_REMOTE_URL} .
else
  echo "Repository already cloned"
fi

# Fetch latest changes
git fetch --all

# Create and checkout branch
git checkout -b ${BRANCH_NAME} || git checkout ${BRANCH_NAME}

# Set git user config from env vars (if provided)
if [ -n "$GIT_AUTHOR_NAME" ]; then
  git config user.name "$GIT_AUTHOR_NAME"
fi
if [ -n "$GIT_AUTHOR_EMAIL" ]; then
  git config user.email "$GIT_AUTHOR_EMAIL"
fi

echo "Git setup complete: branch ${BRANCH_NAME}"
"#;

        Container {
            name: "git-clone".to_string(),
            image: Some("alpine/git:latest".to_string()),
            command: Some(vec!["/bin/sh".to_string(), "-c".to_string()]),
            args: Some(vec![script.to_string()]),
            env: Some(env),
            volume_mounts: Some(vec![VolumeMount {
                name: "workspace".to_string(),
                mount_path: "/workspace".to_string(),
                ..Default::default()
            }]),
            ..Default::default()
        }
    }

    /// Build main container for Claude Code
    #[allow(
        clippy::too_many_arguments,
        reason = "Kubernetes API surface requires many configuration parameters"
    )]
    fn build_main_container(
        &self,
        _pod_name: &str,
        initial_prompt: &str,
        git_user_name: Option<&str>,
        git_user_email: Option<&str>,
        options: &CreateOptions,
    ) -> Container {
        let mut env = vec![
            EnvVar {
                name: "HOME".to_string(),
                value: Some("/workspace".to_string()),
                ..Default::default()
            },
            EnvVar {
                name: "TERM".to_string(),
                value: Some("xterm-256color".to_string()),
                ..Default::default()
            },
            EnvVar {
                name: "CARGO_HOME".to_string(),
                value: Some("/workspace/.cargo".to_string()),
                ..Default::default()
            },
            EnvVar {
                name: "RUSTC_WRAPPER".to_string(),
                value: Some("sccache".to_string()),
                ..Default::default()
            },
            EnvVar {
                name: "SCCACHE_DIR".to_string(),
                value: Some("/workspace/.cache/sccache".to_string()),
                ..Default::default()
            },
        ];

        // Add git user config
        if let Some(name) = git_user_name {
            env.push(EnvVar {
                name: "GIT_AUTHOR_NAME".to_string(),
                value: Some(name.to_string()),
                ..Default::default()
            });
            env.push(EnvVar {
                name: "GIT_COMMITTER_NAME".to_string(),
                value: Some(name.to_string()),
                ..Default::default()
            });
        }

        if let Some(email) = git_user_email {
            env.push(EnvVar {
                name: "GIT_AUTHOR_EMAIL".to_string(),
                value: Some(email.to_string()),
                ..Default::default()
            });
            env.push(EnvVar {
                name: "GIT_COMMITTER_EMAIL".to_string(),
                value: Some(email.to_string()),
                ..Default::default()
            });
        }
        if options.agent == AgentType::Codex {
            env.push(EnvVar {
                name: "CODEX_HOME".to_string(),
                value: Some("/workspace/.codex".to_string()),
                ..Default::default()
            });
        }

        // Add proxy configuration if enabled
        if let Some(ref proxy_config) = self.proxy_config {
            use crate::backends::kubernetes_config::ProxyMode;
            if proxy_config.enabled && self.config.proxy_mode != ProxyMode::Disabled {
                let proxy_port = proxy_config
                    .session_proxy_port
                    .unwrap_or(proxy_config.http_proxy_port);

                // Build proxy URL based on configured mode
                let proxy_url = match self.config.proxy_mode {
                    ProxyMode::ClusterIp => {
                        // Use ClusterIP service - requires service to be created separately
                        // Access via service name from within the cluster
                        let service_port = self.config.proxy_service_port.unwrap_or(8080);
                        Some(format!(
                            "http://clauderon-proxy.{}.svc.cluster.local:{}",
                            self.config.namespace, service_port
                        ))
                    }
                    ProxyMode::HostGateway => {
                        // Use host-gateway (requires hostAliases in pod spec)
                        // This will be configured in build_pod_spec()
                        Some(format!("http://host-gateway:{proxy_port}"))
                    }
                    ProxyMode::Disabled => None,
                };

                if let Some(proxy_url) = proxy_url {
                    env.extend_from_slice(&[
                        EnvVar {
                            name: "HTTP_PROXY".to_string(),
                            value: Some(proxy_url.clone()),
                            ..Default::default()
                        },
                        EnvVar {
                            name: "HTTPS_PROXY".to_string(),
                            value: Some(proxy_url),
                            ..Default::default()
                        },
                        EnvVar {
                            name: "NO_PROXY".to_string(),
                            value: Some("localhost,127.0.0.1,kubernetes.default.svc".to_string()),
                            ..Default::default()
                        },
                        EnvVar {
                            name: "SSL_CERT_FILE".to_string(),
                            value: Some("/etc/clauderon/proxy-ca.pem".to_string()),
                            ..Default::default()
                        },
                        EnvVar {
                            name: "NODE_EXTRA_CA_CERTS".to_string(),
                            value: Some("/etc/clauderon/proxy-ca.pem".to_string()),
                            ..Default::default()
                        },
                        EnvVar {
                            name: "REQUESTS_CA_BUNDLE".to_string(),
                            value: Some("/etc/clauderon/proxy-ca.pem".to_string()),
                            ..Default::default()
                        },
                        EnvVar {
                            name: "GH_TOKEN".to_string(),
                            value: Some("clauderon-proxy".to_string()),
                            ..Default::default()
                        },
                        EnvVar {
                            name: "GITHUB_TOKEN".to_string(),
                            value: Some("clauderon-proxy".to_string()),
                            ..Default::default()
                        },
                    ]);

                    match options.agent {
                        AgentType::ClaudeCode => {
                            env.push(EnvVar {
                                name: "CLAUDE_CODE_OAUTH_TOKEN".to_string(),
                                value: Some("sk-ant-oat01-clauderon-proxy-placeholder".to_string()),
                                ..Default::default()
                            });
                        }
                        AgentType::Codex => {
                            env.push(EnvVar {
                                name: "OPENAI_API_KEY".to_string(),
                                value: Some("sk-openai-clauderon-proxy-placeholder".to_string()),
                                ..Default::default()
                            });
                            env.push(EnvVar {
                                name: "CODEX_API_KEY".to_string(),
                                value: Some("sk-openai-clauderon-proxy-placeholder".to_string()),
                                ..Default::default()
                            });
                        }
                        AgentType::Gemini => {
                            env.push(EnvVar {
                                name: "GEMINI_API_KEY".to_string(),
                                value: Some("sk-gemini-clauderon-proxy-placeholder".to_string()),
                                ..Default::default()
                            });
                        }
                    }
                }
            }
        }

        // Build agent command
        // Build a wrapper script that handles both initial creation and pod restart:
        // - On first run: session file doesn't exist → create new session with prompt
        // - On restart: session file exists → resume session
        let agent_cmd = {
            let escaped_prompt = initial_prompt.replace('\'', "'\\''");

            let quote_arg = |arg: &str| -> String {
                if arg.contains('\'')
                    || arg.contains(' ')
                    || arg.contains('\n')
                    || arg.contains('&')
                    || arg.contains('|')
                {
                    let escaped = arg.replace('\'', "'\\''");
                    format!("'{escaped}'")
                } else {
                    arg.to_string()
                }
            };

            // Translate image paths from host to container
            // Host: /Users/name/.clauderon/uploads/... → Container: /workspace/.clauderon/uploads/...
            let translated_images: Vec<String> = options
                .images
                .iter()
                .map(|image_path| {
                    crate::utils::paths::translate_image_path_to_container(image_path)
                })
                .collect();

            match options.agent {
                AgentType::ClaudeCode => {
                    // Build base args (without session-id, we add it in wrapper)
                    let mut base_args = vec!["claude".to_string()];
                    if options.print_mode {
                        base_args.push("--print".to_string());
                        base_args.push("--verbose".to_string());
                    }
                    if options.plan_mode {
                        base_args.push("--plan".to_string());
                    }
                    if options.dangerous_skip_checks {
                        base_args.push("--dangerously-skip-permissions".to_string());
                    }
                    for image in &translated_images {
                        base_args.push("--image".to_string());
                        base_args.push(image.clone());
                    }

                    if let Some(session_id) = options.session_id {
                        let session_id_str = session_id.to_string();

                        // Build create command with all args
                        let mut create_cmd = base_args.clone();
                        create_cmd.insert(1, "--session-id".to_string());
                        create_cmd.insert(2, session_id_str.clone());
                        if !escaped_prompt.is_empty() {
                            create_cmd.push(escaped_prompt);
                        }
                        let create_cmd = create_cmd
                            .iter()
                            .map(|a| quote_arg(a))
                            .collect::<Vec<_>>()
                            .join(" ");

                        // Build resume command
                        let resume_cmd = if options.dangerous_skip_checks {
                            format!(
                                "claude --dangerously-skip-permissions --resume {} --fork-session",
                                session_id_str
                            )
                        } else {
                            format!("claude --resume {} --fork-session", session_id_str)
                        };

                        // Generate wrapper script
                        let project_path = if options.initial_workdir.as_os_str().is_empty() {
                            "-workspace".to_string()
                        } else {
                            format!(
                                "-workspace-{}",
                                options
                                    .initial_workdir
                                    .display()
                                    .to_string()
                                    .replace('/', "-")
                            )
                        };

                        format!(
                            r#"SESSION_ID="{session_id}"
HISTORY_FILE="/workspace/.claude/projects/{project_path}/${{SESSION_ID}}.jsonl"
if [ -f "$HISTORY_FILE" ]; then
    echo "Resuming existing session $SESSION_ID"
    exec {resume_cmd}
else
    echo "Creating new session $SESSION_ID"
    exec {create_cmd}
fi"#,
                            session_id = session_id_str,
                            project_path = project_path,
                            resume_cmd = resume_cmd,
                            create_cmd = create_cmd,
                        )
                    } else {
                        // No session ID - just run the command directly
                        let mut cmd_vec = base_args;
                        if !escaped_prompt.is_empty() {
                            cmd_vec.push(escaped_prompt);
                        }
                        cmd_vec
                            .iter()
                            .map(|a| quote_arg(a))
                            .collect::<Vec<_>>()
                            .join(" ")
                    }
                }
                AgentType::Codex => {
                    let codex_preamble = r#"CODEX_HOME="/workspace/.codex"
export CODEX_HOME
mkdir -p "$CODEX_HOME"
if [ -f /etc/clauderon/codex/auth.json ]; then
    cp /etc/clauderon/codex/auth.json "$CODEX_HOME/auth.json"
fi
if [ -f /etc/clauderon/codex/config.toml ]; then
    cp /etc/clauderon/codex/config.toml "$CODEX_HOME/config.toml"
fi"#;
                    if options.print_mode {
                        let mut cmd_vec = vec!["codex".to_string()];
                        if options.dangerous_skip_checks {
                            cmd_vec.push("--full-auto".to_string());
                        }
                        cmd_vec.push("exec".to_string());
                        for image in &translated_images {
                            cmd_vec.push("--image".to_string());
                            cmd_vec.push(image.clone());
                        }
                        if !escaped_prompt.is_empty() {
                            cmd_vec.push(escaped_prompt);
                        }
                        let cmd = cmd_vec
                            .iter()
                            .map(|a| quote_arg(a))
                            .collect::<Vec<_>>()
                            .join(" ");
                        format!("{codex_preamble}\n{cmd}")
                    } else {
                        let mut create_cmd_vec = vec!["codex".to_string()];
                        if options.dangerous_skip_checks {
                            create_cmd_vec.push("--full-auto".to_string());
                        }
                        for image in &translated_images {
                            create_cmd_vec.push("--image".to_string());
                            create_cmd_vec.push(image.clone());
                        }
                        if !escaped_prompt.is_empty() {
                            create_cmd_vec.push(escaped_prompt);
                        }
                        let create_cmd = create_cmd_vec
                            .iter()
                            .map(|a| quote_arg(a))
                            .collect::<Vec<_>>()
                            .join(" ");

                        let mut resume_cmd_vec = vec!["codex".to_string()];
                        if options.dangerous_skip_checks {
                            resume_cmd_vec.push("--full-auto".to_string());
                        }
                        resume_cmd_vec.push("resume".to_string());
                        resume_cmd_vec.push("--last".to_string());
                        let resume_cmd = resume_cmd_vec
                            .iter()
                            .map(|a| quote_arg(a))
                            .collect::<Vec<_>>()
                            .join(" ");

                        format!(
                            r#"{codex_preamble}
CODEX_DIR="/workspace/.codex/sessions"
if [ -d "$CODEX_DIR" ] && [ "$(ls -A "$CODEX_DIR" 2>/dev/null)" ]; then
    echo "Resuming last Codex session"
    exec {resume_cmd}
else
    echo "Creating new Codex session"
    exec {create_cmd}
fi"#,
                            resume_cmd = resume_cmd,
                            create_cmd = create_cmd,
                        )
                    }
                }
                AgentType::Gemini => {
                    // Build base args (similar to Claude Code)
                    let mut base_args = vec!["gemini".to_string()];
                    if options.print_mode {
                        base_args.push("--print".to_string());
                    }
                    if options.plan_mode {
                        base_args.push("--plan".to_string());
                    }
                    if options.dangerous_skip_checks {
                        base_args.push("--dangerously-skip-permissions".to_string());
                    }
                    for image in &translated_images {
                        base_args.push("--image".to_string());
                        base_args.push(image.clone());
                    }

                    if let Some(session_id) = options.session_id {
                        let session_id_str = session_id.to_string();

                        // Build create command
                        let mut create_cmd = base_args.clone();
                        create_cmd.insert(1, "--session-id".to_string());
                        create_cmd.insert(2, session_id_str.clone());
                        if !escaped_prompt.is_empty() {
                            create_cmd.push(escaped_prompt.clone());
                        }
                        let create_cmd = create_cmd
                            .iter()
                            .map(|a| quote_arg(a))
                            .collect::<Vec<_>>()
                            .join(" ");

                        // Build resume command
                        let resume_cmd = if options.dangerous_skip_checks {
                            format!(
                                "gemini --dangerously-skip-permissions --resume {} --fork-session",
                                session_id_str
                            )
                        } else {
                            format!("gemini --resume {} --fork-session", session_id_str)
                        };

                        // Generate wrapper script
                        let project_path = if options.initial_workdir.as_os_str().is_empty() {
                            "-workspace".to_string()
                        } else {
                            format!(
                                "-workspace-{}",
                                options
                                    .initial_workdir
                                    .display()
                                    .to_string()
                                    .replace('/', "-")
                            )
                        };

                        format!(
                            r#"SESSION_ID="{session_id}"
HISTORY_FILE="/workspace/.claude/projects/{project_path}/${{SESSION_ID}}.jsonl"
if [ -f "$HISTORY_FILE" ]; then
    echo "Resuming existing session $SESSION_ID"
    exec {resume_cmd}
else
    echo "Creating new session $SESSION_ID"
    exec {create_cmd}
fi"#,
                            session_id = session_id_str,
                            project_path = project_path,
                            resume_cmd = resume_cmd,
                            create_cmd = create_cmd,
                        )
                    } else {
                        // No session ID - just run the command directly
                        let mut cmd_vec = base_args;
                        if !escaped_prompt.is_empty() {
                            cmd_vec.push(escaped_prompt.clone());
                        }
                        cmd_vec
                            .iter()
                            .map(|a| quote_arg(a))
                            .collect::<Vec<_>>()
                            .join(" ")
                    }
                }
            }
        };

        // Volume mounts
        let mut volume_mounts = vec![
            VolumeMount {
                name: "workspace".to_string(),
                mount_path: "/workspace".to_string(),
                ..Default::default()
            },
            VolumeMount {
                name: "cargo-cache".to_string(),
                mount_path: "/workspace/.cargo".to_string(),
                ..Default::default()
            },
            VolumeMount {
                name: "sccache-cache".to_string(),
                mount_path: "/workspace/.cache/sccache".to_string(),
                ..Default::default()
            },
            VolumeMount {
                name: "claude-config".to_string(),
                mount_path: "/workspace/.claude.json".to_string(),
                sub_path: Some("claude.json".to_string()),
                ..Default::default()
            },
            VolumeMount {
                name: "uploads".to_string(),
                mount_path: "/workspace/.clauderon/uploads".to_string(),
                ..Default::default()
            },
        ];

        // Add proxy CA mount if enabled
        if let Some(ref proxy_config) = self.proxy_config {
            if proxy_config.enabled {
                volume_mounts.push(VolumeMount {
                    name: "proxy-ca".to_string(),
                    mount_path: "/etc/clauderon/proxy-ca.pem".to_string(),
                    sub_path: Some("proxy-ca.pem".to_string()),
                    read_only: Some(true),
                    ..Default::default()
                });
            }
        }
        if options.agent == AgentType::Codex {
            if let Some(ref proxy_config) = self.proxy_config {
                if proxy_config.enabled {
                    volume_mounts.push(VolumeMount {
                        name: "codex-config".to_string(),
                        mount_path: "/etc/clauderon/codex".to_string(),
                        read_only: Some(true),
                        ..Default::default()
                    });
                }
            }
        }

        // Determine effective image (override > config)
        let image = options
            .container_image
            .as_ref()
            .map(|ic| ic.image.clone())
            .unwrap_or_else(|| self.config.image.clone());

        // Determine effective image pull policy (override > config)
        let image_pull_policy = options
            .container_image
            .as_ref()
            .map(|ic| ic.pull_policy.to_kubernetes_value())
            .unwrap_or_else(|| self.config.image_pull_policy.to_kubernetes_value());

        tracing::info!(
            image = %image,
            pull_policy = %image_pull_policy,
            has_override = options.container_image.is_some(),
            "Building Kubernetes pod with image settings"
        );

        // Resource requirements (use override if provided, otherwise use config)
        let mut requests = BTreeMap::new();
        let mut limits = BTreeMap::new();

        if let Some(ref resource_override) = options.container_resources {
            // Use override resources
            if let Some(ref cpu) = resource_override.cpu {
                requests.insert("cpu".to_string(), Quantity(cpu.clone()));
                limits.insert("cpu".to_string(), Quantity(cpu.clone()));
            } else {
                // No CPU override, use config
                requests.insert("cpu".to_string(), Quantity(self.config.cpu_request.clone()));
                limits.insert("cpu".to_string(), Quantity(self.config.cpu_limit.clone()));
            }

            if let Some(ref memory) = resource_override.memory {
                requests.insert("memory".to_string(), Quantity(memory.clone()));
                limits.insert("memory".to_string(), Quantity(memory.clone()));
            } else {
                // No memory override, use config
                requests.insert(
                    "memory".to_string(),
                    Quantity(self.config.memory_request.clone()),
                );
                limits.insert(
                    "memory".to_string(),
                    Quantity(self.config.memory_limit.clone()),
                );
            }

            tracing::info!(
                cpu = ?resource_override.cpu,
                memory = ?resource_override.memory,
                "Using custom resource limits for Kubernetes pod"
            );
        } else {
            // No override, use config defaults
            requests.insert("cpu".to_string(), Quantity(self.config.cpu_request.clone()));
            requests.insert(
                "memory".to_string(),
                Quantity(self.config.memory_request.clone()),
            );
            limits.insert("cpu".to_string(), Quantity(self.config.cpu_limit.clone()));
            limits.insert(
                "memory".to_string(),
                Quantity(self.config.memory_limit.clone()),
            );
        }

        Container {
            name: "claude".to_string(),
            image: Some(image),
            image_pull_policy: Some(image_pull_policy.to_string()),
            stdin: Some(true), // REQUIRED for kubectl attach
            tty: Some(true),   // REQUIRED for kubectl attach
            command: Some(vec!["bash".to_string(), "-c".to_string()]),
            args: Some(vec![agent_cmd]),
            working_dir: Some("/workspace".to_string()),
            env: Some(env),
            volume_mounts: Some(volume_mounts),
            resources: Some(ResourceRequirements {
                requests: Some(requests),
                limits: Some(limits),
                ..Default::default()
            }),
            security_context: Some(SecurityContext {
                run_as_non_root: Some(true),
                run_as_user: Some(1000),
                allow_privilege_escalation: Some(false),
                ..Default::default()
            }),
            ..Default::default()
        }
    }

    /// Build pod specification
    #[allow(
        clippy::too_many_arguments,
        reason = "Kubernetes pod spec requires many configuration parameters"
    )]
    fn build_pod_spec(
        &self,
        pod_name: &str,
        session_id: &str,
        session_name: &str,
        git_remote_url: &str,
        branch_name: &str,
        initial_prompt: &str,
        git_user_name: Option<&str>,
        git_user_email: Option<&str>,
        options: &CreateOptions,
    ) -> Pod {
        let init_container =
            self.build_init_container(git_remote_url, branch_name, git_user_name, git_user_email);
        let main_container = self.build_main_container(
            pod_name,
            initial_prompt,
            git_user_name,
            git_user_email,
            options,
        );

        // Build volumes
        let mut volumes = vec![
            Volume {
                name: "workspace".to_string(),
                persistent_volume_claim: Some(
                    k8s_openapi::api::core::v1::PersistentVolumeClaimVolumeSource {
                        claim_name: format!("{pod_name}-workspace"),
                        ..Default::default()
                    },
                ),
                ..Default::default()
            },
            Volume {
                name: "cargo-cache".to_string(),
                persistent_volume_claim: Some(
                    k8s_openapi::api::core::v1::PersistentVolumeClaimVolumeSource {
                        claim_name: "clauderon-cargo-cache".to_string(),
                        ..Default::default()
                    },
                ),
                ..Default::default()
            },
            Volume {
                name: "sccache-cache".to_string(),
                persistent_volume_claim: Some(
                    k8s_openapi::api::core::v1::PersistentVolumeClaimVolumeSource {
                        claim_name: "clauderon-sccache".to_string(),
                        ..Default::default()
                    },
                ),
                ..Default::default()
            },
            Volume {
                name: "claude-config".to_string(),
                config_map: Some(k8s_openapi::api::core::v1::ConfigMapVolumeSource {
                    name: format!("{pod_name}-config"),
                    ..Default::default()
                }),
                ..Default::default()
            },
            Volume {
                name: "uploads".to_string(),
                persistent_volume_claim: Some(
                    k8s_openapi::api::core::v1::PersistentVolumeClaimVolumeSource {
                        claim_name: "clauderon-uploads".to_string(),
                        ..Default::default()
                    },
                ),
                ..Default::default()
            },
        ];

        // Add proxy CA volume if enabled
        if let Some(ref proxy_config) = self.proxy_config {
            if proxy_config.enabled {
                volumes.push(Volume {
                    name: "proxy-ca".to_string(),
                    config_map: Some(k8s_openapi::api::core::v1::ConfigMapVolumeSource {
                        name: "clauderon-proxy-ca".to_string(),
                        ..Default::default()
                    }),
                    ..Default::default()
                });
            }
        }
        if options.agent == AgentType::Codex {
            if let Some(ref proxy_config) = self.proxy_config {
                if proxy_config.enabled {
                    volumes.push(Volume {
                        name: "codex-config".to_string(),
                        config_map: Some(k8s_openapi::api::core::v1::ConfigMapVolumeSource {
                            name: format!("{pod_name}-codex-config"),
                            ..Default::default()
                        }),
                        ..Default::default()
                    });
                }
            }
        }

        let mut labels = BTreeMap::new();
        labels.insert("clauderon.io/managed".to_string(), "true".to_string());
        labels.insert(
            "clauderon.io/session-id".to_string(),
            session_id.to_string(),
        );
        labels.insert(
            "clauderon.io/session-name".to_string(),
            session_name.to_string(),
        );
        labels.insert("clauderon.io/backend".to_string(), "kubernetes".to_string());

        // Add host aliases for host-gateway mode
        use crate::backends::kubernetes_config::ProxyMode;
        let host_aliases = if self.config.proxy_mode == ProxyMode::HostGateway {
            if let Some(ref host_ip) = self.config.host_gateway_ip {
                Some(vec![HostAlias {
                    hostnames: Some(vec!["host-gateway".to_string()]),
                    ip: host_ip.clone(),
                }])
            } else {
                tracing::warn!("proxy_mode is HostGateway but host_gateway_ip is not set");
                None
            }
        } else {
            None
        };

        Pod {
            metadata: ObjectMeta {
                name: Some(pod_name.to_string()),
                namespace: Some(self.config.namespace.clone()),
                labels: Some(labels),
                ..Default::default()
            },
            spec: Some(PodSpec {
                init_containers: Some(vec![init_container]),
                containers: vec![main_container],
                volumes: Some(volumes),
                restart_policy: Some("Never".to_string()),
                service_account_name: Some(self.config.service_account.clone()),
                security_context: Some(PodSecurityContext {
                    fs_group: Some(1000),
                    ..Default::default()
                }),
                host_aliases,
                ..Default::default()
            }),
            ..Default::default()
        }
    }

    /// Wait for pod to reach Running state
    async fn wait_for_pod_running(&self, pod_name: &str) -> anyhow::Result<()> {
        let pods: Api<Pod> = Api::namespaced(self.client.clone(), &self.config.namespace);

        let result = timeout(Duration::from_secs(60), async {
            loop {
                match pods.get(pod_name).await {
                    Ok(pod) => {
                        if let Some(status) = pod.status {
                            if let Some(phase) = status.phase {
                                match phase.as_str() {
                                    "Running" => return Ok(()),
                                    "Failed" | "Unknown" => {
                                        let events = self.get_pod_events(pod_name)?;
                                        anyhow::bail!(
                                            "Pod failed to start (phase: {phase})\nEvents:\n{}",
                                            events.join("\n")
                                        );
                                    }
                                    _ => {
                                        // Still pending or initializing
                                        tokio::time::sleep(Duration::from_secs(2)).await;
                                    }
                                }
                            }
                        }
                    }
                    Err(e) => {
                        anyhow::bail!("Failed to get pod status: {e}");
                    }
                }
            }
        })
        .await;

        match result {
            Ok(Ok(())) => Ok(()),
            Ok(Err(e)) => Err(e),
            Err(_) => {
                let events = self.get_pod_events(pod_name)?;
                anyhow::bail!(
                    "Timeout waiting for pod to start\nEvents:\n{}",
                    events.join("\n")
                );
            }
        }
    }

    /// Get pod events for diagnostics
    fn get_pod_events(&self, pod_name: &str) -> Vec<String> {
        // For simplicity, return empty events list
        // In a full implementation, you would fetch events from the Events API
        vec![format!("Pod: {pod_name}")]
    }
}

#[async_trait]
impl ExecutionBackend for KubernetesBackend {
    async fn create(
        &self,
        name: &str,
        workdir: &Path,
        initial_prompt: &str,
        options: CreateOptions,
    ) -> anyhow::Result<String> {
        let pod_name = Self::pod_name(name);

        // Ensure namespace exists
        self.ensure_namespace_exists().await?;

        // Detect or use configured git remote URL
        let git_remote_url = if let Some(ref url) = self.config.git_remote_url {
            url.clone()
        } else {
            Self::detect_git_remote(workdir, &self.config.git_remote_name).await?
        };

        // Read git user config
        let (git_user_name, git_user_email) = Self::read_git_user_config().await;

        // Ensure shared cache PVCs exist
        self.ensure_shared_pvcs_exist().await?;

        // Create workspace PVC for this session
        // Use actual session ID from options for proper PVC labeling and tracking
        let session_id = options
            .session_id
            .ok_or_else(|| anyhow::anyhow!("session_id is required for Kubernetes backend"))?
            .to_string();
        self.create_workspace_pvc(&pod_name, &session_id).await?;

        // Create Claude config ConfigMap
        self.create_claude_config_configmap(&pod_name).await?;
        if options.agent == AgentType::Codex {
            self.create_codex_config_configmap(&pod_name).await?;
        }

        // Create proxy ConfigMap if needed
        self.create_proxy_configmap().await?;

        // Build and create pod
        let pod_spec = self.build_pod_spec(
            &pod_name,
            &session_id,
            name,
            &git_remote_url,
            name, // Use session name as branch name
            initial_prompt,
            git_user_name.as_deref(),
            git_user_email.as_deref(),
            &options,
        );

        let pods: Api<Pod> = Api::namespaced(self.client.clone(), &self.config.namespace);
        pods.create(&PostParams::default(), &pod_spec).await?;

        // Wait for pod to be running
        self.wait_for_pod_running(&pod_name).await?;

        Ok(pod_name)
    }

    async fn exists(&self, id: &str) -> anyhow::Result<bool> {
        let pods: Api<Pod> = Api::namespaced(self.client.clone(), &self.config.namespace);

        match pods.get(id).await {
            Ok(_) => Ok(true),
            Err(kube::Error::Api(err)) if err.code == 404 => Ok(false),
            Err(e) => Err(e.into()),
        }
    }

    async fn delete(&self, id: &str) -> anyhow::Result<()> {
        let pods: Api<Pod> = Api::namespaced(self.client.clone(), &self.config.namespace);
        let pvcs: Api<PersistentVolumeClaim> =
            Api::namespaced(self.client.clone(), &self.config.namespace);
        let cms: Api<ConfigMap> = Api::namespaced(self.client.clone(), &self.config.namespace);

        // Delete pod
        match pods.delete(id, &DeleteParams::default()).await {
            Ok(_) => tracing::info!("Deleted pod {id}"),
            Err(kube::Error::Api(err)) if err.code == 404 => {
                tracing::debug!("Pod {id} already deleted");
            }
            Err(e) => return Err(e.into()),
        }

        // Delete ConfigMap
        let config_name = format!("{id}-config");
        match cms.delete(&config_name, &DeleteParams::default()).await {
            Ok(_) => tracing::info!("Deleted ConfigMap {config_name}"),
            Err(kube::Error::Api(err)) if err.code == 404 => {
                tracing::debug!("ConfigMap {config_name} already deleted");
            }
            Err(e) => tracing::warn!("Failed to delete ConfigMap {config_name}: {e}"),
        }
        let codex_config_name = format!("{id}-codex-config");
        match cms
            .delete(&codex_config_name, &DeleteParams::default())
            .await
        {
            Ok(_) => tracing::info!("Deleted ConfigMap {codex_config_name}"),
            Err(kube::Error::Api(err)) if err.code == 404 => {
                tracing::debug!("ConfigMap {codex_config_name} already deleted");
            }
            Err(e) => tracing::warn!("Failed to delete ConfigMap {codex_config_name}: {e}"),
        }

        // Delete workspace PVC (log warning on failure)
        let pvc_name = format!("{id}-workspace");
        match pvcs.delete(&pvc_name, &DeleteParams::default()).await {
            Ok(_) => tracing::info!("Deleted PVC {pvc_name}"),
            Err(kube::Error::Api(err)) if err.code == 404 => {
                tracing::debug!("PVC {pvc_name} already deleted");
            }
            Err(e) => tracing::warn!("Failed to delete PVC {pvc_name}: {e}"),
        }

        Ok(())
    }

    fn attach_command(&self, id: &str) -> Vec<String> {
        vec![
            "kubectl".to_string(),
            "attach".to_string(),
            "-it".to_string(),
            "-n".to_string(),
            self.config.namespace.clone(),
            id.to_string(),
            "-c".to_string(),
            "claude".to_string(),
        ]
    }

    async fn get_output(&self, id: &str, lines: usize) -> anyhow::Result<String> {
        let pods: Api<Pod> = Api::namespaced(self.client.clone(), &self.config.namespace);

        let log_params = LogParams {
            container: Some("claude".to_string()),
            tail_lines: Some(lines.try_into().unwrap_or(100)),
            ..Default::default()
        };

        let logs = pods.logs(id, &log_params).await?;
        Ok(logs)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pod_name_generation() {
        let name = KubernetesBackend::pod_name("my-session");
        assert_eq!(name, "clauderon-my-session");
    }

    #[tokio::test]
    async fn test_attach_command_format() {
        // Install crypto provider for rustls (required by kube client)
        let _ = rustls::crypto::ring::default_provider().install_default();

        // Skip if k8s not available
        if Client::try_default().await.is_err() {
            return;
        }

        let config = KubernetesConfig::default();
        let backend = KubernetesBackend::new(config).await.unwrap();
        let cmd = backend.attach_command("test-pod");
        assert_eq!(cmd[0], "kubectl");
        assert_eq!(cmd[1], "attach");
        assert_eq!(cmd[2], "-it");
        assert!(cmd.contains(&"test-pod".to_string()));
    }
}
