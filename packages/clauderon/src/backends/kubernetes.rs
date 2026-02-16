use anyhow::Context;
use async_trait::async_trait;
use k8s_openapi::api::core::v1::{
    ConfigMap, Container, EnvVar, HostAlias, Namespace, PersistentVolumeClaim,
    PersistentVolumeClaimSpec, Pod, PodSecurityContext, PodSpec, ResourceRequirements,
    SecurityContext, Volume, VolumeMount, VolumeResourceRequirements,
};
use k8s_openapi::api::storage::v1::StorageClass;
use k8s_openapi::apimachinery::pkg::api::resource::Quantity;
use k8s_openapi::apimachinery::pkg::apis::meta::v1::ObjectMeta;
use kube::Client;
use kube::api::{Api, DeleteParams, ListParams, LogParams, PostParams};
use std::collections::BTreeMap;
use std::path::Path;
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

use super::container_config::ImageConfig;
use super::kubernetes_config::{KubernetesConfig, KubernetesProxyConfig};
use super::traits::{CreateOptions, ExecutionBackend};
use crate::core::AgentType;
use crate::plugins::PluginDiscovery;
use crate::proxy::{dummy_auth_json_string, dummy_config_toml};

/// Information about a Kubernetes storage class
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct StorageClassInfo {
    /// Storage class name
    pub name: String,
    /// Provisioner (e.g., "kubernetes.io/aws-ebs")
    pub provisioner: String,
    /// Whether this is the default storage class
    pub is_default: bool,
}

/// Sanitize git config value to prevent environment variable injection
///
/// Removes all control characters (including newlines, tabs, etc.) that could be used for injection attacks
fn sanitize_git_config_value(value: &str) -> String {
    value.chars().filter(|c| !c.is_control()).collect()
}

/// Validate image name to prevent command injection
///
/// Validates using the ImageConfig validation logic to ensure consistency
/// across all backends.
fn validate_image_name(image: &str) -> anyhow::Result<()> {
    // Create a temporary ImageConfig to reuse Docker's validation logic
    let image_config = ImageConfig {
        image: image.to_owned(),
        pull_policy: super::container_config::ImagePullPolicy::IfNotPresent,
        registry_auth: None,
    };
    image_config.validate()
}

/// Kubernetes backend for running Claude Code sessions in pods
pub struct KubernetesBackend {
    config: KubernetesConfig,
    proxy_config: Option<KubernetesProxyConfig>,
    client: Client,
}

impl std::fmt::Debug for KubernetesBackend {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("KubernetesBackend")
            .field("config", &self.config)
            .finish_non_exhaustive()
    }
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

        let url = String::from_utf8(output.stdout)?.trim().to_owned();
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

    /// List available storage classes in the cluster
    ///
    /// Returns a list of storage class names and metadata including which one is default.
    ///
    /// # Errors
    ///
    /// Returns an error if the Kubernetes API is unreachable or returns an error.
    pub async fn list_storage_classes(&self) -> anyhow::Result<Vec<StorageClassInfo>> {
        let storage_classes: Api<StorageClass> = Api::all(self.client.clone());

        let list = storage_classes
            .list(&ListParams::default())
            .await
            .context("Failed to list storage classes from Kubernetes API")?;

        let mut classes = Vec::new();
        for sc in list.items {
            let name = sc.metadata.name.unwrap_or_default();

            // Check if this is the default storage class
            let is_default = sc
                .metadata
                .annotations
                .as_ref()
                .and_then(|annotations| {
                    annotations
                        .get("storageclass.kubernetes.io/is-default-class")
                        .or_else(|| {
                            annotations.get("storageclass.beta.kubernetes.io/is-default-class")
                        })
                })
                .is_some_and(|v| v == "true");

            classes.push(StorageClassInfo {
                name,
                provisioner: sc.provisioner,
                is_default,
            });
        }

        // Sort: default first, then alphabetically
        classes.sort_by(|a, b| match (a.is_default, b.is_default) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.cmp(&b.name),
        });

        Ok(classes)
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
    async fn ensure_shared_pvcs_exist(&self, options: &CreateOptions) -> anyhow::Result<()> {
        let pvcs: Api<PersistentVolumeClaim> =
            Api::namespaced(self.client.clone(), &self.config.namespace);

        // Create cargo cache PVC if it doesn't exist
        if pvcs.get("clauderon-cargo-cache").await.is_err() {
            self.create_shared_pvc(
                "clauderon-cargo-cache",
                &self.config.cargo_cache_size,
                options,
            )
            .await?;
            tracing::info!("Created shared cargo cache PVC");
        }

        // Create sccache PVC if it doesn't exist
        if pvcs.get("clauderon-sccache").await.is_err() {
            self.create_shared_pvc(
                "clauderon-sccache",
                &self.config.sccache_cache_size,
                options,
            )
            .await?;
            tracing::info!("Created shared sccache PVC");
        }

        // Create uploads PVC for image attachments (shared across sessions)
        // Unlike workspace PVCs which are per-session, uploads are shared with session-id subdirectories
        if pvcs.get("clauderon-uploads").await.is_err() {
            self.create_shared_pvc("clauderon-uploads", "10Gi", options)
                .await?;
            tracing::info!("Created shared uploads PVC");
        }

        Ok(())
    }

    /// Create a shared PVC for caching
    ///
    /// Tries ReadWriteMany first, falls back to ReadWriteOnce if RWX is not available
    async fn create_shared_pvc(
        &self,
        name: &str,
        size: &str,
        options: &CreateOptions,
    ) -> anyhow::Result<()> {
        let pvcs: Api<PersistentVolumeClaim> =
            Api::namespaced(self.client.clone(), &self.config.namespace);

        let mut resources = BTreeMap::new();
        resources.insert("storage".to_owned(), Quantity(size.to_owned()));

        // Determine access mode based on config
        let access_modes = if self.config.use_rwo_cache {
            vec!["ReadWriteOnce".to_owned()]
        } else {
            vec!["ReadWriteMany".to_owned()]
        };

        let pvc = PersistentVolumeClaim {
            metadata: ObjectMeta {
                name: Some(name.to_owned()),
                namespace: Some(self.config.namespace.clone()),
                labels: Some({
                    let mut labels = BTreeMap::new();
                    labels.insert("clauderon.io/managed".to_owned(), "true".to_owned());
                    labels.insert("clauderon.io/type".to_owned(), "cache".to_owned());
                    labels
                }),
                ..Default::default()
            },
            spec: Some(PersistentVolumeClaimSpec {
                access_modes: Some(access_modes.clone()),
                storage_class_name: options
                    .storage_class_override
                    .clone()
                    .or_else(|| self.config.storage_class.clone()),
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
                rwo_labels.insert("clauderon.io/managed".to_owned(), "true".to_owned());
                rwo_labels.insert("clauderon.io/type".to_owned(), "cache".to_owned());
                rwo_labels.insert(
                    "clauderon.io/access-mode".to_owned(),
                    "rwo-fallback".to_owned(),
                );

                let rwo_pvc = PersistentVolumeClaim {
                    metadata: ObjectMeta {
                        name: Some(name.to_owned()),
                        namespace: Some(self.config.namespace.clone()),
                        labels: Some(rwo_labels),
                        ..Default::default()
                    },
                    spec: Some(PersistentVolumeClaimSpec {
                        access_modes: Some(vec!["ReadWriteOnce".to_owned()]),
                        storage_class_name: options
                            .storage_class_override
                            .clone()
                            .or_else(|| self.config.storage_class.clone()),
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
    async fn create_workspace_pvc(
        &self,
        pod_name: &str,
        session_id: &str,
        options: &CreateOptions,
    ) -> anyhow::Result<()> {
        let pvcs: Api<PersistentVolumeClaim> =
            Api::namespaced(self.client.clone(), &self.config.namespace);

        let pvc_name = format!("{pod_name}-workspace");
        let mut resources = BTreeMap::new();
        resources.insert(
            "storage".to_owned(),
            Quantity(self.config.workspace_pvc_size.clone()),
        );

        let pvc = PersistentVolumeClaim {
            metadata: ObjectMeta {
                name: Some(pvc_name),
                namespace: Some(self.config.namespace.clone()),
                labels: Some({
                    let mut labels = BTreeMap::new();
                    labels.insert("clauderon.io/managed".to_owned(), "true".to_owned());
                    labels.insert("clauderon.io/type".to_owned(), "workspace".to_owned());
                    labels.insert(
                        "clauderon.io/session-id".to_owned(),
                        session_id.to_owned(),
                    );
                    labels
                }),
                ..Default::default()
            },
            spec: Some(PersistentVolumeClaimSpec {
                access_modes: Some(vec!["ReadWriteOnce".to_owned()]),
                storage_class_name: options
                    .storage_class_override
                    .clone()
                    .or_else(|| self.config.storage_class.clone()),
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
        data.insert("claude.json".to_owned(), claude_config.to_string());

        let cm = ConfigMap {
            metadata: ObjectMeta {
                name: Some(format!("{pod_name}-config")),
                namespace: Some(self.config.namespace.clone()),
                labels: Some({
                    let mut labels = BTreeMap::new();
                    labels.insert("clauderon.io/managed".to_owned(), "true".to_owned());
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
            .unwrap_or_else(|_| dummy_config_toml().to_owned());

        let mut data = BTreeMap::new();
        data.insert("auth.json".to_owned(), auth_json);
        data.insert("config.toml".to_owned(), config_toml);

        let cm = ConfigMap {
            metadata: ObjectMeta {
                name: Some(format!("{pod_name}-codex-config")),
                namespace: Some(self.config.namespace.clone()),
                labels: Some({
                    let mut labels = BTreeMap::new();
                    labels.insert("clauderon.io/managed".to_owned(), "true".to_owned());
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

    /// Create ConfigMap for managed settings (bypass permissions mode)
    ///
    /// This ConfigMap provides Claude Code with managed settings that enable
    /// bypass permissions mode when proxy is enabled.
    async fn create_managed_settings_configmap(&self, pod_name: &str) -> anyhow::Result<()> {
        // Only create managed settings when proxy is enabled
        let Some(ref proxy_config) = self.proxy_config else {
            return Ok(());
        };

        if !proxy_config.enabled {
            return Ok(());
        }

        let cms: Api<ConfigMap> = Api::namespaced(self.client.clone(), &self.config.namespace);

        // Managed settings content (same as Docker backend)
        let managed_settings = serde_json::json!({
            "permissions": {
                "defaultMode": "bypassPermissions"
            }
        });

        let mut data = BTreeMap::new();
        data.insert(
            "managed-settings.json".to_owned(),
            managed_settings.to_string(),
        );

        let cm = ConfigMap {
            metadata: ObjectMeta {
                name: Some(format!("{pod_name}-managed-settings")),
                namespace: Some(self.config.namespace.clone()),
                labels: Some({
                    let mut labels = BTreeMap::new();
                    labels.insert("clauderon.io/managed".to_owned(), "true".to_owned());
                    labels
                }),
                ..Default::default()
            },
            data: Some(data),
            ..Default::default()
        };

        cms.create(&PostParams::default(), &cm).await?;
        tracing::info!("Created managed settings ConfigMap for {pod_name}");
        Ok(())
    }

    /// Create ConfigMap for kubeconfig (for kubectl access in containers)
    async fn create_kube_config_configmap(&self, pod_name: &str) -> anyhow::Result<()> {
        let cms: Api<ConfigMap> = Api::namespaced(self.client.clone(), &self.config.namespace);

        // Read kubeconfig from ~/.clauderon/kube/config
        let kube_config_path = dirs::home_dir()
            .unwrap_or_else(|| std::path::PathBuf::from("/tmp"))
            .join(".clauderon/kube/config");

        let kube_config_content = std::fs::read_to_string(&kube_config_path)
            .context("Failed to read kubeconfig from ~/.clauderon/kube/config")?;

        let mut data = BTreeMap::new();
        data.insert("config".to_owned(), kube_config_content);

        let cm = ConfigMap {
            metadata: ObjectMeta {
                name: Some(format!("{pod_name}-kube-config")),
                namespace: Some(self.config.namespace.clone()),
                labels: Some({
                    let mut labels = BTreeMap::new();
                    labels.insert("clauderon.io/managed".to_owned(), "true".to_owned());
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
        data.insert("proxy-ca.pem".to_owned(), ca_cert);

        let cm = ConfigMap {
            metadata: ObjectMeta {
                name: Some("clauderon-proxy-ca".to_owned()),
                namespace: Some(self.config.namespace.clone()),
                labels: Some({
                    let mut labels = BTreeMap::new();
                    labels.insert("clauderon.io/managed".to_owned(), "true".to_owned());
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
                name: "GIT_REMOTE_URL".to_owned(),
                value: Some(git_remote_url.to_owned()),
                ..Default::default()
            },
            EnvVar {
                name: "BRANCH_NAME".to_owned(),
                value: Some(branch_name.to_owned()),
                ..Default::default()
            },
        ];

        if let Some(name) = git_user_name {
            env.push(EnvVar {
                name: "GIT_AUTHOR_NAME".to_owned(),
                value: Some(name.to_owned()),
                ..Default::default()
            });
        }

        if let Some(email) = git_user_email {
            env.push(EnvVar {
                name: "GIT_AUTHOR_EMAIL".to_owned(),
                value: Some(email.to_owned()),
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

# Create cache directories with correct permissions
# This prevents PVC mounts from being owned by root
mkdir -p .cargo/registry .cargo/git .cache/sccache
echo "Created cache directories"

echo "Git setup complete: branch ${BRANCH_NAME}"
"#;

        Container {
            name: "git-clone".to_owned(),
            image: Some("alpine/git:latest".to_owned()),
            command: Some(vec!["/bin/sh".to_owned(), "-c".to_owned()]),
            args: Some(vec![script.to_owned()]),
            env: Some(env),
            volume_mounts: Some(vec![VolumeMount {
                name: "workspace".to_owned(),
                mount_path: "/workspace".to_owned(),
                ..Default::default()
            }]),
            ..Default::default()
        }
    }

    /// Build main container for Claude Code
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
                name: "HOME".to_owned(),
                value: Some("/workspace".to_owned()),
                ..Default::default()
            },
            EnvVar {
                name: "TERM".to_owned(),
                value: Some("xterm-256color".to_owned()),
                ..Default::default()
            },
            EnvVar {
                name: "CARGO_HOME".to_owned(),
                value: Some("/workspace/.cargo".to_owned()),
                ..Default::default()
            },
            EnvVar {
                name: "RUSTC_WRAPPER".to_owned(),
                value: Some("sccache".to_owned()),
                ..Default::default()
            },
            EnvVar {
                name: "SCCACHE_DIR".to_owned(),
                value: Some("/workspace/.cache/sccache".to_owned()),
                ..Default::default()
            },
        ];

        // Add git user config
        if let Some(name) = git_user_name {
            env.push(EnvVar {
                name: "GIT_AUTHOR_NAME".to_owned(),
                value: Some(name.to_owned()),
                ..Default::default()
            });
            env.push(EnvVar {
                name: "GIT_COMMITTER_NAME".to_owned(),
                value: Some(name.to_owned()),
                ..Default::default()
            });
        }

        if let Some(email) = git_user_email {
            env.push(EnvVar {
                name: "GIT_AUTHOR_EMAIL".to_owned(),
                value: Some(email.to_owned()),
                ..Default::default()
            });
            env.push(EnvVar {
                name: "GIT_COMMITTER_EMAIL".to_owned(),
                value: Some(email.to_owned()),
                ..Default::default()
            });
        }
        if options.agent == AgentType::Codex {
            env.push(EnvVar {
                name: "CODEX_HOME".to_owned(),
                value: Some("/workspace/.codex".to_owned()),
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
                            name: "HTTP_PROXY".to_owned(),
                            value: Some(proxy_url.clone()),
                            ..Default::default()
                        },
                        EnvVar {
                            name: "HTTPS_PROXY".to_owned(),
                            value: Some(proxy_url),
                            ..Default::default()
                        },
                        EnvVar {
                            name: "NO_PROXY".to_owned(),
                            value: Some("localhost,127.0.0.1,kubernetes.default.svc".to_owned()),
                            ..Default::default()
                        },
                        EnvVar {
                            name: "SSL_CERT_FILE".to_owned(),
                            value: Some("/etc/clauderon/proxy-ca.pem".to_owned()),
                            ..Default::default()
                        },
                        EnvVar {
                            name: "NODE_EXTRA_CA_CERTS".to_owned(),
                            value: Some("/etc/clauderon/proxy-ca.pem".to_owned()),
                            ..Default::default()
                        },
                        EnvVar {
                            name: "REQUESTS_CA_BUNDLE".to_owned(),
                            value: Some("/etc/clauderon/proxy-ca.pem".to_owned()),
                            ..Default::default()
                        },
                        EnvVar {
                            name: "GH_TOKEN".to_owned(),
                            value: Some("clauderon-proxy".to_owned()),
                            ..Default::default()
                        },
                        EnvVar {
                            name: "GITHUB_TOKEN".to_owned(),
                            value: Some("clauderon-proxy".to_owned()),
                            ..Default::default()
                        },
                    ]);

                    match options.agent {
                        AgentType::ClaudeCode => {
                            env.push(EnvVar {
                                name: "CLAUDE_CODE_OAUTH_TOKEN".to_owned(),
                                value: Some("sk-ant-oat01-clauderon-proxy-placeholder".to_owned()),
                                ..Default::default()
                            });
                        }
                        AgentType::Codex => {
                            env.push(EnvVar {
                                name: "OPENAI_API_KEY".to_owned(),
                                value: Some("sk-openai-clauderon-proxy-placeholder".to_owned()),
                                ..Default::default()
                            });
                            env.push(EnvVar {
                                name: "CODEX_API_KEY".to_owned(),
                                value: Some("sk-openai-clauderon-proxy-placeholder".to_owned()),
                                ..Default::default()
                            });
                        }
                        AgentType::Gemini => {
                            env.push(EnvVar {
                                name: "GEMINI_API_KEY".to_owned(),
                                value: Some("sk-gemini-clauderon-proxy-placeholder".to_owned()),
                                ..Default::default()
                            });
                        }
                    }
                }
            }
        }

        // Add KUBECONFIG environment variable
        env.push(EnvVar {
            name: "KUBECONFIG".to_owned(),
            value: Some("/etc/clauderon/kube/config".to_owned()),
            ..Default::default()
        });

        // Enable 24-bit truecolor support for Claude Code terminal output
        env.push(EnvVar {
            name: "COLORTERM".to_owned(),
            value: Some("truecolor".to_owned()),
            ..Default::default()
        });

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
                    arg.to_owned()
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
                    let mut base_args = vec!["claude".to_owned()];
                    if options.print_mode {
                        base_args.push("--print".to_owned());
                        base_args.push("--verbose".to_owned());
                    }
                    if options.plan_mode {
                        base_args.push("--plan".to_owned());
                    }
                    if options.dangerous_skip_checks {
                        base_args.push("--dangerously-skip-permissions".to_owned());
                    }
                    for image in &translated_images {
                        base_args.push("--image".to_owned());
                        base_args.push(image.clone());
                    }

                    if let Some(session_id) = options.session_id {
                        let session_id_str = session_id.to_string();

                        // Build create command with all args
                        let mut create_cmd = base_args.clone();
                        create_cmd.insert(1, "--session-id".to_owned());
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
                            "-workspace".to_owned()
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
                        let mut cmd_vec = vec!["codex".to_owned()];
                        if options.dangerous_skip_checks {
                            cmd_vec.push("--full-auto".to_owned());
                        }
                        cmd_vec.push("exec".to_owned());
                        for image in &translated_images {
                            cmd_vec.push("--image".to_owned());
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
                        let mut create_cmd_vec = vec!["codex".to_owned()];
                        if options.dangerous_skip_checks {
                            create_cmd_vec.push("--full-auto".to_owned());
                        }
                        for image in &translated_images {
                            create_cmd_vec.push("--image".to_owned());
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

                        let mut resume_cmd_vec = vec!["codex".to_owned()];
                        if options.dangerous_skip_checks {
                            resume_cmd_vec.push("--full-auto".to_owned());
                        }
                        resume_cmd_vec.push("resume".to_owned());
                        resume_cmd_vec.push("--last".to_owned());
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
                    let mut base_args = vec!["gemini".to_owned()];
                    if options.print_mode {
                        base_args.push("--print".to_owned());
                    }
                    if options.plan_mode {
                        base_args.push("--plan".to_owned());
                    }
                    if options.dangerous_skip_checks {
                        base_args.push("--dangerously-skip-permissions".to_owned());
                    }
                    for image in &translated_images {
                        base_args.push("--image".to_owned());
                        base_args.push(image.clone());
                    }

                    if let Some(session_id) = options.session_id {
                        let session_id_str = session_id.to_string();

                        // Build create command
                        let mut create_cmd = base_args.clone();
                        create_cmd.insert(1, "--session-id".to_owned());
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
                                "gemini --dangerously-skip-permissions --resume {} --fork-session",
                                session_id_str
                            )
                        } else {
                            format!("gemini --resume {} --fork-session", session_id_str)
                        };

                        // Generate wrapper script
                        let project_path = if options.initial_workdir.as_os_str().is_empty() {
                            "-workspace".to_owned()
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
            }
        };

        // Volume mounts
        let mut volume_mounts = vec![
            VolumeMount {
                name: "workspace".to_owned(),
                mount_path: "/workspace".to_owned(),
                ..Default::default()
            },
            VolumeMount {
                name: "cargo-cache".to_owned(),
                mount_path: "/workspace/.cargo".to_owned(),
                ..Default::default()
            },
            VolumeMount {
                name: "sccache-cache".to_owned(),
                mount_path: "/workspace/.cache/sccache".to_owned(),
                ..Default::default()
            },
            VolumeMount {
                name: "claude-config".to_owned(),
                mount_path: "/workspace/.claude.json".to_owned(),
                sub_path: Some("claude.json".to_owned()),
                ..Default::default()
            },
            VolumeMount {
                name: "uploads".to_owned(),
                mount_path: "/workspace/.clauderon/uploads".to_owned(),
                ..Default::default()
            },
        ];

        // Add proxy CA mount if enabled
        if let Some(ref proxy_config) = self.proxy_config {
            if proxy_config.enabled {
                volume_mounts.push(VolumeMount {
                    name: "proxy-ca".to_owned(),
                    mount_path: "/etc/clauderon/proxy-ca.pem".to_owned(),
                    sub_path: Some("proxy-ca.pem".to_owned()),
                    read_only: Some(true),
                    ..Default::default()
                });
            }
        }
        if options.agent == AgentType::Codex {
            if let Some(ref proxy_config) = self.proxy_config {
                if proxy_config.enabled {
                    volume_mounts.push(VolumeMount {
                        name: "codex-config".to_owned(),
                        mount_path: "/etc/clauderon/codex".to_owned(),
                        read_only: Some(true),
                        ..Default::default()
                    });
                }
            }
        }

        // Add managed settings mount if proxy is enabled
        if let Some(ref proxy_config) = self.proxy_config {
            if proxy_config.enabled {
                volume_mounts.push(VolumeMount {
                    name: "managed-settings".to_owned(),
                    mount_path: "/etc/claude-code/managed-settings.json".to_owned(),
                    sub_path: Some("managed-settings.json".to_owned()),
                    read_only: Some(true),
                    ..Default::default()
                });
            }
        }

        // Add kubeconfig mount for kubectl access
        volume_mounts.push(VolumeMount {
            name: "kube-config".to_owned(),
            mount_path: "/etc/clauderon/kube".to_owned(),
            read_only: Some(true),
            ..Default::default()
        });

        // Determine effective image (override > config)
        let image = options
            .container_image
            .as_ref()
            .map_or_else(|| self.config.image.clone(), |ic| ic.image.clone());

        // Determine effective image pull policy (override > config)
        let image_pull_policy = options.container_image.as_ref().map_or_else(
            || self.config.image_pull_policy.to_kubernetes_value(),
            |ic| ic.pull_policy.to_kubernetes_value(),
        );

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
                requests.insert("cpu".to_owned(), Quantity(cpu.clone()));
                limits.insert("cpu".to_owned(), Quantity(cpu.clone()));
            } else {
                // No CPU override, use config
                requests.insert("cpu".to_owned(), Quantity(self.config.cpu_request.clone()));
                limits.insert("cpu".to_owned(), Quantity(self.config.cpu_limit.clone()));
            }

            if let Some(ref memory) = resource_override.memory {
                requests.insert("memory".to_owned(), Quantity(memory.clone()));
                limits.insert("memory".to_owned(), Quantity(memory.clone()));
            } else {
                // No memory override, use config
                requests.insert(
                    "memory".to_owned(),
                    Quantity(self.config.memory_request.clone()),
                );
                limits.insert(
                    "memory".to_owned(),
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
            requests.insert("cpu".to_owned(), Quantity(self.config.cpu_request.clone()));
            requests.insert(
                "memory".to_owned(),
                Quantity(self.config.memory_request.clone()),
            );
            limits.insert("cpu".to_owned(), Quantity(self.config.cpu_limit.clone()));
            limits.insert(
                "memory".to_owned(),
                Quantity(self.config.memory_limit.clone()),
            );
        }

        Container {
            name: "claude".to_owned(),
            image: Some(image),
            image_pull_policy: Some(image_pull_policy.to_owned()),
            stdin: Some(true), // REQUIRED for kubectl attach
            tty: Some(true),   // REQUIRED for kubectl attach
            command: Some(vec!["bash".to_owned(), "-c".to_owned()]),
            args: Some(vec![agent_cmd]),
            working_dir: Some("/workspace".to_owned()),
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
    #[expect(
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
                name: "workspace".to_owned(),
                persistent_volume_claim: Some(
                    k8s_openapi::api::core::v1::PersistentVolumeClaimVolumeSource {
                        claim_name: format!("{pod_name}-workspace"),
                        ..Default::default()
                    },
                ),
                ..Default::default()
            },
            Volume {
                name: "cargo-cache".to_owned(),
                persistent_volume_claim: Some(
                    k8s_openapi::api::core::v1::PersistentVolumeClaimVolumeSource {
                        claim_name: "clauderon-cargo-cache".to_owned(),
                        ..Default::default()
                    },
                ),
                ..Default::default()
            },
            Volume {
                name: "sccache-cache".to_owned(),
                persistent_volume_claim: Some(
                    k8s_openapi::api::core::v1::PersistentVolumeClaimVolumeSource {
                        claim_name: "clauderon-sccache".to_owned(),
                        ..Default::default()
                    },
                ),
                ..Default::default()
            },
            Volume {
                name: "claude-config".to_owned(),
                config_map: Some(k8s_openapi::api::core::v1::ConfigMapVolumeSource {
                    name: format!("{pod_name}-config"),
                    ..Default::default()
                }),
                ..Default::default()
            },
            Volume {
                name: "uploads".to_owned(),
                persistent_volume_claim: Some(
                    k8s_openapi::api::core::v1::PersistentVolumeClaimVolumeSource {
                        claim_name: "clauderon-uploads".to_owned(),
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
                    name: "proxy-ca".to_owned(),
                    config_map: Some(k8s_openapi::api::core::v1::ConfigMapVolumeSource {
                        name: "clauderon-proxy-ca".to_owned(),
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
                        name: "codex-config".to_owned(),
                        config_map: Some(k8s_openapi::api::core::v1::ConfigMapVolumeSource {
                            name: format!("{pod_name}-codex-config"),
                            ..Default::default()
                        }),
                        ..Default::default()
                    });
                }
            }
        }

        // Add managed settings volume if proxy is enabled
        if let Some(ref proxy_config) = self.proxy_config {
            if proxy_config.enabled {
                volumes.push(Volume {
                    name: "managed-settings".to_owned(),
                    config_map: Some(k8s_openapi::api::core::v1::ConfigMapVolumeSource {
                        name: format!("{pod_name}-managed-settings"),
                        ..Default::default()
                    }),
                    ..Default::default()
                });
            }
        }

        // Add kubeconfig volume for kubectl access
        volumes.push(Volume {
            name: "kube-config".to_owned(),
            config_map: Some(k8s_openapi::api::core::v1::ConfigMapVolumeSource {
                name: format!("{pod_name}-kube-config"),
                ..Default::default()
            }),
            ..Default::default()
        });

        let mut labels = BTreeMap::new();
        labels.insert("clauderon.io/managed".to_owned(), "true".to_owned());
        labels.insert(
            "clauderon.io/session-id".to_owned(),
            session_id.to_owned(),
        );
        labels.insert(
            "clauderon.io/session-name".to_owned(),
            session_name.to_owned(),
        );
        labels.insert("clauderon.io/backend".to_owned(), "kubernetes".to_owned());

        // Add host aliases for host-gateway mode
        use crate::backends::kubernetes_config::ProxyMode;
        let host_aliases = if self.config.proxy_mode == ProxyMode::HostGateway {
            if let Some(ref host_ip) = self.config.host_gateway_ip {
                Some(vec![HostAlias {
                    hostnames: Some(vec!["host-gateway".to_owned()]),
                    ip: host_ip.clone(),
                }])
            } else {
                tracing::warn!("proxy_mode is HostGateway but host_gateway_ip is not set");
                None
            }
        } else {
            None
        };

        // Build annotations from extra_annotations config
        let annotations = if self.config.extra_annotations.is_empty() {
            None
        } else {
            Some(self.config.extra_annotations.clone())
        };

        Pod {
            metadata: ObjectMeta {
                name: Some(pod_name.to_owned()),
                namespace: Some(self.config.namespace.clone()),
                labels: Some(labels),
                annotations,
                ..Default::default()
            },
            spec: Some(PodSpec {
                init_containers: Some(vec![init_container]),
                containers: vec![main_container],
                volumes: Some(volumes),
                restart_policy: Some("Never".to_owned()),
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

    /// Stop a pod while preserving its workspace PVC
    ///
    /// This is used for archiving sessions - the pod and ConfigMaps are deleted
    /// but the workspace PVC is preserved so the session can be unarchived later.
    ///
    /// # Errors
    ///
    /// Returns an error if the Kubernetes API operations fail.
    pub async fn stop_pod_preserve_storage(&self, id: &str) -> anyhow::Result<()> {
        let pods: Api<Pod> = Api::namespaced(self.client.clone(), &self.config.namespace);
        let cms: Api<ConfigMap> = Api::namespaced(self.client.clone(), &self.config.namespace);

        // Delete pod
        match pods.delete(id, &DeleteParams::default()).await {
            Ok(_) => tracing::info!("Deleted pod {id}"),
            Err(kube::Error::Api(err)) if err.code == 404 => {
                tracing::debug!("Pod {id} already deleted");
            }
            Err(e) => return Err(e.into()),
        }

        // Delete ConfigMaps (but NOT the workspace PVC)
        let configmaps_to_delete = [
            format!("{id}-config"),
            format!("{id}-codex-config"),
            format!("{id}-managed-settings"),
            format!("{id}-kube-config"),
        ];

        for config_name in configmaps_to_delete {
            match cms.delete(&config_name, &DeleteParams::default()).await {
                Ok(_) => tracing::info!("Deleted ConfigMap {config_name}"),
                Err(kube::Error::Api(err)) if err.code == 404 => {
                    tracing::debug!("ConfigMap {config_name} already deleted");
                }
                Err(e) => tracing::warn!("Failed to delete ConfigMap {config_name}: {e}"),
            }
        }

        tracing::info!(pod_name = id, "Stopped pod while preserving workspace PVC");

        Ok(())
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
    fn get_pod_events(&self, pod_name: &str) -> anyhow::Result<Vec<String>> {
        // For simplicity, return empty events list
        // In a full implementation, you would fetch events from the Events API
        Ok(vec![format!("Pod: {pod_name}")])
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
        // TODO: Add multi-repository support
        // When options.repositories is non-empty:
        // 1. Create multiple PVCs (one per repo)
        // 2. Clone each repo into its respective PVC
        // 3. Mount primary PVC to /workspace
        // 4. Mount secondary PVCs to /repos/{mount_name}
        // 5. Handle git worktree parent .git directories for each repo
        if !options.repositories.is_empty() {
            anyhow::bail!(
                "Multi-repository sessions are not yet supported for Kubernetes backend. \
                Please use Docker backend for multi-repo sessions."
            );
        }

        let pod_name = Self::pod_name(name);

        // Ensure namespace exists
        self.ensure_namespace_exists().await?;

        // Validate image names (security: prevent command injection)
        validate_image_name(&self.config.image).context("Invalid container image in config")?;
        if let Some(ref image_config) = options.container_image {
            image_config
                .validate()
                .context("Invalid container image override")?;
        }

        // Detect or use configured git remote URL
        let git_remote_url = if let Some(ref url) = self.config.git_remote_url {
            url.clone()
        } else {
            Self::detect_git_remote(workdir, &self.config.git_remote_name).await?
        };

        // Read git user config
        let (git_user_name, git_user_email) = Self::read_git_user_config().await;

        // Ensure shared cache PVCs exist
        self.ensure_shared_pvcs_exist(&options).await?;

        // Create workspace PVC for this session
        // Use actual session ID from options for proper PVC labeling and tracking
        let session_id = options
            .session_id
            .ok_or_else(|| anyhow::anyhow!("session_id is required for Kubernetes backend"))?
            .to_string();
        self.create_workspace_pvc(&pod_name, &session_id, &options)
            .await?;

        // Create Claude config ConfigMap
        self.create_claude_config_configmap(&pod_name).await?;
        if options.agent == AgentType::Codex {
            self.create_codex_config_configmap(&pod_name).await?;
        }

        // Create managed settings ConfigMap (for bypass permissions mode)
        self.create_managed_settings_configmap(&pod_name).await?;

        // Create kubeconfig ConfigMap
        self.create_kube_config_configmap(&pod_name).await?;

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

        // Delete managed settings ConfigMap
        let managed_settings_name = format!("{id}-managed-settings");
        match cms
            .delete(&managed_settings_name, &DeleteParams::default())
            .await
        {
            Ok(_) => tracing::info!("Deleted ConfigMap {managed_settings_name}"),
            Err(kube::Error::Api(err)) if err.code == 404 => {
                tracing::debug!("ConfigMap {managed_settings_name} already deleted");
            }
            Err(e) => tracing::warn!("Failed to delete ConfigMap {managed_settings_name}: {e}"),
        }

        // Delete kubeconfig ConfigMap
        let kube_config_name = format!("{id}-kube-config");
        match cms
            .delete(&kube_config_name, &DeleteParams::default())
            .await
        {
            Ok(_) => tracing::info!("Deleted ConfigMap {kube_config_name}"),
            Err(kube::Error::Api(err)) if err.code == 404 => {
                tracing::debug!("ConfigMap {kube_config_name} already deleted");
            }
            Err(e) => tracing::warn!("Failed to delete ConfigMap {kube_config_name}: {e}"),
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
            "kubectl".to_owned(),
            "attach".to_owned(),
            "-it".to_owned(),
            "-n".to_owned(),
            self.config.namespace.clone(),
            id.to_owned(),
            "-c".to_owned(),
            "claude".to_owned(),
        ]
    }

    async fn get_output(&self, id: &str, lines: usize) -> anyhow::Result<String> {
        let pods: Api<Pod> = Api::namespaced(self.client.clone(), &self.config.namespace);

        let log_params = LogParams {
            container: Some("claude".to_owned()),
            tail_lines: Some(lines.try_into().unwrap_or(100)),
            ..Default::default()
        };

        let logs = pods.logs(id, &log_params).await?;
        Ok(logs)
    }

    fn is_remote(&self) -> bool {
        true
    }

    /// Get Kubernetes backend capabilities
    ///
    /// Kubernetes preserves data because workspace PVCs are not deleted on pod recreation.
    fn capabilities(&self) -> super::traits::BackendCapabilities {
        super::traits::BackendCapabilities {
            can_recreate: true,
            can_update_image: true,
            preserves_data_on_recreate: true,
            can_start: false, // Kubernetes pods can't be "started" - they restart automatically
            can_wake: false,
            data_preservation_description: "Your code is safe (stored in persistent volume). Only pod-local files will be lost.",
        }
    }

    /// Check the health of a Kubernetes pod
    ///
    /// Uses the Kubernetes API to get detailed pod state.
    async fn check_health(&self, id: &str) -> anyhow::Result<super::traits::BackendResourceHealth> {
        use super::traits::BackendResourceHealth;

        let pods: Api<Pod> = Api::namespaced(self.client.clone(), &self.config.namespace);

        match pods.get(id).await {
            Ok(pod) => {
                let status = pod.status.as_ref();
                let phase = status.and_then(|s| s.phase.as_ref());

                // Check for CrashLoopBackOff in container statuses
                if let Some(container_statuses) = status.and_then(|s| s.container_statuses.as_ref())
                {
                    for cs in container_statuses {
                        if let Some(waiting) = cs.state.as_ref().and_then(|s| s.waiting.as_ref()) {
                            if waiting.reason.as_deref() == Some("CrashLoopBackOff") {
                                return Ok(BackendResourceHealth::CrashLoop);
                            }
                        }
                    }
                }

                match phase.map(String::as_str) {
                    Some("Running") => Ok(BackendResourceHealth::Running),
                    Some("Pending") => Ok(BackendResourceHealth::Pending),
                    Some("Succeeded") => Ok(BackendResourceHealth::Stopped),
                    Some("Failed") => {
                        let reason = status
                            .and_then(|s| s.message.clone())
                            .unwrap_or_else(|| "Pod failed".to_owned());
                        Ok(BackendResourceHealth::Error { message: reason })
                    }
                    Some("Unknown") | None => {
                        let reason = status
                            .and_then(|s| s.message.clone())
                            .unwrap_or_else(|| "Pod in unknown state".to_owned());
                        Ok(BackendResourceHealth::Error { message: reason })
                    }
                    Some(other) => Ok(BackendResourceHealth::Error {
                        message: format!("Unknown pod phase: {other}"),
                    }),
                }
            }
            Err(kube::Error::Api(e)) if e.code == 404 => Ok(BackendResourceHealth::NotFound),
            Err(e) => Err(e.into()),
        }
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
        assert!(cmd.contains(&"test-pod".to_owned()));
    }
}
