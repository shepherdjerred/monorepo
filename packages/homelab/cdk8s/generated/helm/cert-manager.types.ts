// Generated TypeScript types for cert-manager Helm chart

export type CertmanagerHelmValuesGlobal = {
  imagePullSecrets?: unknown[];
  /**
   * Global node selector
   * The nodeSelector on Pods tells Kubernetes to schedule Pods on the nodes with
   * matching labels.
   * For more information, see [Assigning Pods to Nodes](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/).
   * If a component-specific nodeSelector is also set, it will be merged and take precedence.
   * +docs:property
   *
   * @default {}
   */
  nodeSelector?: CertmanagerHelmValuesGlobalNodeSelector;
  /**
   * Labels to apply to all resources.
   * Please note that this does not add labels to the resources created dynamically by the controllers.
   * For these resources, you have to add the labels in the template in the cert-manager custom resource:
   * For example, podTemplate/ ingressTemplate in ACMEChallengeSolverHTTP01Ingress
   * For more information, see the [cert-manager documentation](https://cert-manager.io/docs/reference/api-docs/#acme.cert-manager.io/v1.ACMEChallengeSolverHTTP01Ingress).
   * For example, secretTemplate in CertificateSpec
   * For more information, see the [cert-manager documentation](https://cert-manager.io/docs/reference/api-docs/#cert-manager.io/v1.CertificateSpec).
   *
   * @default {}
   */
  commonLabels?: CertmanagerHelmValuesGlobalCommonLabels;
  /**
   * The number of old ReplicaSets to retain to allow rollback (if not set, the default Kubernetes value is set to 10).
   * +docs:property
   * The optional priority class to be used for the cert-manager pods.
   *
   * @default ""
   */
  priorityClassName?: string;
  /**
   * Set all pods to run in a user namespace without host access.
   * Experimental: may be removed once the Kubernetes User Namespaces feature is GA.
   * Set to false to run pods in a user namespace without host access.
   * See [limitations](https://kubernetes.io/docs/concepts/workloads/pods/user-namespaces/#limitations) for details.
   * +docs:property
   *
   * @default {"create":true,"aggregateClusterRoles":true}
   */
  rbac?: CertmanagerHelmValuesGlobalRbac;
  /**
   * @default {"enabled":false,"useAppArmor":true}
   */
  podSecurityPolicy?: CertmanagerHelmValuesGlobalPodSecurityPolicy;
  /**
   * Set the verbosity of cert-manager. A range of 0 - 6, with 6 being the most verbose.
   *
   * @default 2
   */
  logLevel?: number;
  /**
   * The duration that non-leader candidates will wait after observing a
   * leadership renewal until attempting to acquire leadership of a led but
   * unrenewed leader slot. This is effectively the maximum duration that a
   * leader can be stopped before it is replaced by another candidate.
   * +docs:property
   * The interval between attempts by the acting master to renew a leadership
   * slot before it stops leading. This must be less than or equal to the
   * lease duration.
   * +docs:property
   * The duration the clients should wait between attempting acquisition and
   * renewal of a leadership.
   * +docs:property
   * This option is equivalent to setting crds.enabled=true and crds.keep=true.
   * Deprecated: use crds.enabled and crds.keep instead.
   *
   * @default {"namespace":"kube-system"}
   */
  leaderElection?: CertmanagerHelmValuesGlobalLeaderElection;
};

export type CertmanagerHelmValuesGlobalNodeSelector = object;

export type CertmanagerHelmValuesGlobalCommonLabels = object;

export type CertmanagerHelmValuesGlobalRbac = {
  /**
   * Create required ClusterRoles and ClusterRoleBindings for cert-manager.
   *
   * @default true
   */
  create?: boolean;
  /**
   * Aggregate ClusterRoles to Kubernetes default user-facing roles. For more information, see [User-facing roles](https://kubernetes.io/docs/reference/access-authn-authz/rbac/#user-facing-roles)
   *
   * @default true
   */
  aggregateClusterRoles?: boolean;
};

export type CertmanagerHelmValuesGlobalPodSecurityPolicy = {
  /**
   * Create PodSecurityPolicy for cert-manager.
   * Note that PodSecurityPolicy was deprecated in Kubernetes 1.21 and removed in Kubernetes 1.25.
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Configure the PodSecurityPolicy to use AppArmor.
   *
   * @default true
   */
  useAppArmor?: boolean;
};

export type CertmanagerHelmValuesGlobalLeaderElection = {
  /**
   * Override the namespace used for the leader election lease.
   *
   * @default "kube-system"
   */
  namespace?: string;
};

export type CertmanagerHelmValuesCrds = {
  /**
   * This option decides if the CRDs should be installed
   * as part of the Helm installation.
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * This option makes it so that the "helm.sh/resource-policy": keep
   * annotation is added to the CRD. This will prevent Helm from uninstalling
   * the CRD when the Helm release is uninstalled.
   * WARNING: when the CRDs are removed, all cert-manager custom resources
   * (Certificates, Issuers, ...) will be removed too by the garbage collector.
   *
   * @default true
   */
  keep?: boolean;
};

export type CertmanagerHelmValuesStrategy = object;

export type CertmanagerHelmValuesPodDisruptionBudget = {
  /**
   * Enable or disable the PodDisruptionBudget resource.
   * This prevents downtime during voluntary disruptions such as during a Node upgrade.
   * For example, the PodDisruptionBudget will block `kubectl drain`
   * if it is used on the Node where the only remaining cert-manager
   * Pod is currently running.
   *
   * @default false
   */
  enabled?: boolean;
};

export type CertmanagerHelmValuesImage = {
  /**
   * The container registry to pull the manager image from.
   * +docs:property
   * The container image for the cert-manager controller.
   * +docs:property
   *
   * @default "quay.io/jetstack/cert-manager-controller"
   */
  repository?: string;
  /**
   * Override the image tag to deploy by setting this variable.
   * If no value is set, the chart's appVersion is used.
   * +docs:property
   * Setting a digest will override any tag.
   * +docs:property
   * digest: sha256:0e072dddd1f7f8fc8909a2ca6f65e76c5f0d2fcfb8be47935ae3457e8bbceb20
   * Kubernetes imagePullPolicy on Deployment.
   *
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
};

export type CertmanagerHelmValuesServiceAccount = {
  /**
   * Specifies whether a service account should be created.
   *
   * @default true
   */
  create?: boolean;
  /**
   * The name of the service account to use.
   * If not set and create is true, a name is generated using the fullname template.
   * +docs:property
   * Optional additional annotations to add to the controller's Service Account. Templates are allowed for both keys and values.
   * Optional additional labels to add to the controller's Service Account.
   * +docs:property
   * Automount API credentials for a Service Account.
   *
   * @default true
   */
  automountServiceAccountToken?: boolean;
};

export type CertmanagerHelmValuesConfig = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type CertmanagerHelmValuesResources = object;

export type CertmanagerHelmValuesSecurityContext = {
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: CertmanagerHelmValuesSecurityContextSeccompProfile;
};

export type CertmanagerHelmValuesSecurityContextSeccompProfile = {
  /**
   * @default "RuntimeDefault"
   */
  type?: string;
};

export type CertmanagerHelmValuesContainerSecurityContext = {
  /**
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: CertmanagerHelmValuesContainerSecurityContextCapabilities;
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
};

export type CertmanagerHelmValuesContainerSecurityContextCapabilities = {
  drop?: string[];
};

export type CertmanagerHelmValuesPodLabels = object;

export type CertmanagerHelmValuesNodeSelector = {
  /**
   * @default "linux"
   */
  "kubernetes.io/os"?: string;
};

export type CertmanagerHelmValuesIngressShim = object;

export type CertmanagerHelmValuesAffinity = object;

export type CertmanagerHelmValuesLivenessProbe = {
  /**
   * @default true
   */
  enabled?: boolean;
  /**
   * @default 10
   */
  initialDelaySeconds?: number;
  /**
   * @default 10
   */
  periodSeconds?: number;
  /**
   * @default 15
   */
  timeoutSeconds?: number;
  /**
   * @default 1
   */
  successThreshold?: number;
  /**
   * @default 8
   */
  failureThreshold?: number;
};

export type CertmanagerHelmValuesPrometheus = {
  /**
   * Enable Prometheus monitoring for the cert-manager controller and webhook.
   * If you use the Prometheus Operator, set prometheus.podmonitor.enabled or
   * prometheus.servicemonitor.enabled, to create a PodMonitor or a
   * ServiceMonitor resource.
   * Otherwise, 'prometheus.io' annotations are added to the cert-manager and
   * cert-manager-webhook Deployments.
   * Note that you cannot enable both PodMonitor and ServiceMonitor as they are
   * mutually exclusive. Enabling both will result in an error.
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * @default {...} (10 keys)
   */
  servicemonitor?: CertmanagerHelmValuesPrometheusServicemonitor;
  /**
   * Note that you cannot enable both PodMonitor and ServiceMonitor as they are mutually exclusive. Enabling both will result in an error.
   *
   * @default {...} (9 keys)
   */
  podmonitor?: CertmanagerHelmValuesPrometheusPodmonitor;
};

export type CertmanagerHelmValuesPrometheusServicemonitor = {
  /**
   * Create a ServiceMonitor to add cert-manager to Prometheus.
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * The namespace that the service monitor should live in, defaults
   * to the cert-manager namespace.
   * +docs:property
   * Specifies the `prometheus` label on the created ServiceMonitor. This is
   * used when different Prometheus instances have label selectors matching
   * different ServiceMonitors.
   *
   * @default "default"
   */
  prometheusInstance?: string | number | boolean;
  /**
   * The target port to set on the ServiceMonitor. This must match the port that the
   * cert-manager controller is listening on for metrics.
   * +docs:type=string,integer
   *
   * @default "http-metrics"
   */
  targetPort?: string;
  /**
   * The path to scrape for metrics.
   *
   * @default "/metrics"
   */
  path?: string;
  /**
   * The interval to scrape metrics.
   *
   * @default "60s"
   */
  interval?: string;
  /**
   * The timeout before a metrics scrape fails.
   *
   * @default "30s"
   */
  scrapeTimeout?: string;
  /**
   * Additional labels to add to the ServiceMonitor.
   *
   * @default {}
   */
  labels?: CertmanagerHelmValuesPrometheusServicemonitorLabels;
  /**
   * Additional annotations to add to the ServiceMonitor.
   *
   * @default {}
   */
  annotations?: CertmanagerHelmValuesPrometheusServicemonitorAnnotations;
  /**
   * Keep labels from scraped data, overriding server-side labels.
   *
   * @default false
   */
  honorLabels?: boolean;
  /**
   * EndpointAdditionalProperties allows setting additional properties on the
   * endpoint such as relabelings, metricRelabelings etc.
   * For example:
   * +docs:property
   *
   * @default {}
   */
  endpointAdditionalProperties?: CertmanagerHelmValuesPrometheusServicemonitorEndpointAdditionalProperties;
};

export type CertmanagerHelmValuesPrometheusServicemonitorLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type CertmanagerHelmValuesPrometheusServicemonitorAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type CertmanagerHelmValuesPrometheusServicemonitorEndpointAdditionalProperties = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type CertmanagerHelmValuesPrometheusPodmonitor = {
  /**
   * Create a PodMonitor to add cert-manager to Prometheus.
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * The namespace that the pod monitor should live in, defaults
   * to the cert-manager namespace.
   * +docs:property
   * Specifies the `prometheus` label on the created PodMonitor. This is
   * used when different Prometheus instances have label selectors matching
   * different PodMonitors.
   *
   * @default "default"
   */
  prometheusInstance?: string | number | boolean;
  /**
   * The path to scrape for metrics.
   *
   * @default "/metrics"
   */
  path?: string;
  /**
   * The interval to scrape metrics.
   *
   * @default "60s"
   */
  interval?: string;
  /**
   * The timeout before a metrics scrape fails.
   *
   * @default "30s"
   */
  scrapeTimeout?: string;
  /**
   * Additional labels to add to the PodMonitor.
   *
   * @default {}
   */
  labels?: CertmanagerHelmValuesPrometheusPodmonitorLabels;
  /**
   * Additional annotations to add to the PodMonitor.
   *
   * @default {}
   */
  annotations?: CertmanagerHelmValuesPrometheusPodmonitorAnnotations;
  /**
   * Keep labels from scraped data, overriding server-side labels.
   *
   * @default false
   */
  honorLabels?: boolean;
  /**
   * +docs:property
   *
   * @default {}
   */
  endpointAdditionalProperties?: CertmanagerHelmValuesPrometheusPodmonitorEndpointAdditionalProperties;
};

export type CertmanagerHelmValuesPrometheusPodmonitorLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type CertmanagerHelmValuesPrometheusPodmonitorAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type CertmanagerHelmValuesPrometheusPodmonitorEndpointAdditionalProperties = object;

export type CertmanagerHelmValuesWebhook = {
  /**
   * Number of replicas of the cert-manager webhook to run.
   * The default is 1, but in production set this to 2 or 3 to provide high
   * availability.
   * If `replicas > 1`, consider setting `webhook.podDisruptionBudget.enabled=true`.
   *
   * @default 1
   */
  replicaCount?: number;
  /**
   * The number of seconds the API server should wait for the webhook to respond before treating the call as a failure.
   * The value must be between 1 and 30 seconds. For more information, see
   * [Validating webhook configuration v1](https://kubernetes.io/docs/reference/kubernetes-api/extend-resources/validating-webhook-configuration-v1/).
   * The default is set to the maximum value of 30 seconds as
   * users sometimes report that the connection between the K8S API server and
   * the cert-manager webhook server times out.
   * If *this* timeout is reached, the error message will be "context deadline exceeded",
   * which doesn't help the user diagnose what phase of the HTTPS connection timed out.
   * For example, it could be during DNS resolution, TCP connection, TLS
   * negotiation, HTTP negotiation, or slow HTTP response from the webhook
   * server.
   * By setting this timeout to its maximum value the underlying timeout error
   * message has more chance of being returned to the end user.
   *
   * @default 30
   */
  timeoutSeconds?: number;
  /**
   * @default {}
   */
  config?: CertmanagerHelmValuesWebhookConfig;
  /**
   * @default {}
   */
  strategy?: CertmanagerHelmValuesWebhookStrategy;
  /**
   * Pod Security Context to be set on the webhook component Pod.
   * For more information, see [Configure a Security Context for a Pod or Container](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/).
   * +docs:property
   *
   * @default {"runAsNonRoot":true,"seccompProfile":{"type":"RuntimeDefault"}}
   */
  securityContext?: CertmanagerHelmValuesWebhookSecurityContext;
  /**
   * Container Security Context to be set on the webhook component container.
   * For more information, see [Configure a Security Context for a Pod or Container](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/).
   * +docs:property
   *
   * @default {"allowPrivilegeEscalation":false,"capabilities":{"drop":["ALL"]},"readOnlyRootFilesystem":true}
   */
  containerSecurityContext?: CertmanagerHelmValuesWebhookContainerSecurityContext;
  /**
   * This property configures the minimum available pods for disruptions. Can either be set to
   * an integer (e.g., 1) or a percentage value (e.g., 25%).
   * It cannot be used if `maxUnavailable` is set.
   * +docs:property
   * +docs:type=unknown
   * This property configures the maximum unavailable pods for disruptions. Can either be set to
   * an integer (e.g., 1) or a percentage value (e.g., 25%).
   * It cannot be used if `minAvailable` is set.
   * +docs:property
   * +docs:type=unknown
   * Optional additional annotations to add to the webhook Deployment.
   * +docs:property
   * Optional additional annotations to add to the webhook Pods.
   * +docs:property
   * Optional additional annotations to add to the webhook Service.
   * +docs:property
   * Optional additional annotations to add to the webhook MutatingWebhookConfiguration.
   * +docs:property
   * Optional additional annotations to add to the webhook ValidatingWebhookConfiguration.
   * +docs:property
   *
   * @default {"enabled":false}
   */
  podDisruptionBudget?: CertmanagerHelmValuesWebhookPodDisruptionBudget;
  /**
   * @default {"namespaceSelector":{"matchExpressions":[{"key":"cert-manager.io/disable-validation","operator":"NotIn","values":["true"]}]}}
   */
  validatingWebhookConfiguration?: CertmanagerHelmValuesWebhookValidatingWebhookConfiguration;
  /**
   * @default {"namespaceSelector":{}}
   */
  mutatingWebhookConfiguration?: CertmanagerHelmValuesWebhookMutatingWebhookConfiguration;
  extraArgs?: unknown[];
  extraEnv?: unknown[];
  /**
   * Comma separated list of feature gates that should be enabled on the
   * webhook pod.
   *
   * @default ""
   */
  featureGates?: string;
  /**
   * For more information, see [Resource Management for Pods and Containers](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/).
   *
   * @default {}
   */
  resources?: CertmanagerHelmValuesWebhookResources;
  /**
   * Liveness probe values.
   * For more information, see [Container probes](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#container-probes).
   * +docs:property
   *
   * @default {...} (5 keys)
   */
  livenessProbe?: CertmanagerHelmValuesWebhookLivenessProbe;
  /**
   * Readiness probe values.
   * For more information, see [Container probes](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#container-probes).
   * +docs:property
   *
   * @default {...} (5 keys)
   */
  readinessProbe?: CertmanagerHelmValuesWebhookReadinessProbe;
  /**
   * The nodeSelector on Pods tells Kubernetes to schedule Pods on the nodes with
   * matching labels.
   * For more information, see [Assigning Pods to Nodes](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/).
   * This default ensures that Pods are only scheduled to Linux nodes.
   * It prevents Pods being scheduled to Windows nodes in a mixed OS cluster.
   * +docs:property
   *
   * @default {"kubernetes.io/os":"linux"}
   */
  nodeSelector?: CertmanagerHelmValuesWebhookNodeSelector;
  /**
   * @default {}
   */
  affinity?: CertmanagerHelmValuesWebhookAffinity;
  tolerations?: unknown[];
  topologySpreadConstraints?: unknown[];
  /**
   * Optional additional labels to add to the Webhook Pods.
   *
   * @default {}
   */
  podLabels?: CertmanagerHelmValuesWebhookPodLabels;
  /**
   * Optional additional labels to add to the Webhook Service.
   *
   * @default {}
   */
  serviceLabels?: CertmanagerHelmValuesWebhookServiceLabels;
  /**
   * Optionally set the IP family policy for the controller Service to configure dual-stack; see [Configure dual-stack](https://kubernetes.io/docs/concepts/services-networking/dual-stack/#services).
   *
   * @default ""
   */
  serviceIPFamilyPolicy?: string;
  serviceIPFamilies?: unknown[];
  /**
   * @default {"repository":"quay.io/jetstack/cert-manager-webhook","pullPolicy":"IfNotPresent"}
   */
  image?: CertmanagerHelmValuesWebhookImage;
  /**
   * @default {"create":true,"automountServiceAccountToken":true}
   */
  serviceAccount?: CertmanagerHelmValuesWebhookServiceAccount;
  /**
   * Automounting API credentials for a particular pod.
   * +docs:property
   * The port that the webhook listens on for requests.
   * In GKE private clusters, by default Kubernetes apiservers are allowed to
   * talk to the cluster nodes only on 443 and 10250. Configuring
   * securePort: 10250, therefore will work out-of-the-box without needing to add firewall
   * rules or requiring NET_BIND_SERVICE capabilities to bind port numbers <1000.
   *
   * @default 10250
   */
  securePort?: number;
  /**
   * Specifies if the webhook should be started in hostNetwork mode.
   * Required for use in some managed kubernetes clusters (such as AWS EKS) with custom
   * CNI (such as calico), because control-plane managed by AWS cannot communicate
   * with pods' IP CIDR and admission webhooks are not working
   * Since the default port for the webhook conflicts with kubelet on the host
   * network, `webhook.securePort` should be changed to an available port if
   * running in hostNetwork mode.
   *
   * @default false
   */
  hostNetwork?: boolean;
  /**
   * Specifies how the service should be handled. Useful if you want to expose the
   * webhook outside of the cluster. In some cases, the control plane cannot
   * reach internal services.
   *
   * @default "ClusterIP"
   */
  serviceType?: string;
  /**
   * Specify the load balancer IP for the created service.
   * +docs:property
   * Overrides the mutating webhook and validating webhook so they reach the webhook
   * service using the `url` field instead of a service.
   *
   * @default {}
   */
  url?: CertmanagerHelmValuesWebhookUrl;
  /**
   * Enables default network policies for webhooks.
   *
   * @default {"enabled":false,"ingress":[{"from":[{"ipBlock":{"cidr":"0.0.0.0/0"}},{"ipBlock":{"cidr":"::/0"}}]}],"egress":[{"ports":[{"port":80,"protocol":"TCP"},{"port":443,"protocol":"TCP"},{"port":53,"protocol":"TCP"},{"port":53,"protocol":"UDP"},{"port":6443,"protocol":"TCP"}],"to":[{"ipBlock":{"cidr":"0.0.0.0/0"}},{"ipBlock":{"cidr":"::/0"}}]}]}
   */
  networkPolicy?: CertmanagerHelmValuesWebhookNetworkPolicy;
  volumes?: unknown[];
  volumeMounts?: unknown[];
  /**
   * enableServiceLinks indicates whether information about services should be
   * injected into the pod's environment variables, matching the syntax of Docker
   * links.
   *
   * @default false
   */
  enableServiceLinks?: boolean;
};

export type CertmanagerHelmValuesWebhookConfig = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type CertmanagerHelmValuesWebhookStrategy = object;

export type CertmanagerHelmValuesWebhookSecurityContext = {
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: CertmanagerHelmValuesWebhookSecurityContextSeccompProfile;
};

export type CertmanagerHelmValuesWebhookSecurityContextSeccompProfile = {
  /**
   * @default "RuntimeDefault"
   */
  type?: string;
};

export type CertmanagerHelmValuesWebhookContainerSecurityContext = {
  /**
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: CertmanagerHelmValuesWebhookContainerSecurityContextCapabilities;
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
};

export type CertmanagerHelmValuesWebhookContainerSecurityContextCapabilities = {
  drop?: string[];
};

export type CertmanagerHelmValuesWebhookPodDisruptionBudget = {
  /**
   * Enable or disable the PodDisruptionBudget resource.
   * This prevents downtime during voluntary disruptions such as during a Node upgrade.
   * For example, the PodDisruptionBudget will block `kubectl drain`
   * if it is used on the Node where the only remaining cert-manager
   * Pod is currently running.
   *
   * @default false
   */
  enabled?: boolean;
};

export type CertmanagerHelmValuesWebhookValidatingWebhookConfiguration = {
  /**
   * Configure spec.namespaceSelector for validating webhooks.
   * +docs:property
   *
   * @default {"matchExpressions":[{"key":"cert-manager.io/disable-validation","operator":"NotIn","values":["true"]}]}
   */
  namespaceSelector?: CertmanagerHelmValuesWebhookValidatingWebhookConfigurationNamespaceSelector;
};

export type CertmanagerHelmValuesWebhookValidatingWebhookConfigurationNamespaceSelector = {
  matchExpressions?: CertmanagerHelmValuesWebhookValidatingWebhookConfigurationNamespaceSelectorMatchExpressionsElement[];
};

export type CertmanagerHelmValuesWebhookValidatingWebhookConfigurationNamespaceSelectorMatchExpressionsElement = {
  /**
   * @default "cert-manager.io/disable-validation"
   */
  key?: string;
  /**
   * @default "NotIn"
   */
  operator?: string;
  values?: boolean[];
};

export type CertmanagerHelmValuesWebhookMutatingWebhookConfiguration = {
  /**
   * Configure spec.namespaceSelector for mutating webhooks.
   * +docs:property
   *
   * @default {}
   */
  namespaceSelector?: CertmanagerHelmValuesWebhookMutatingWebhookConfigurationNamespaceSelector;
};

export type CertmanagerHelmValuesWebhookMutatingWebhookConfigurationNamespaceSelector = object;

export type CertmanagerHelmValuesWebhookResources = object;

export type CertmanagerHelmValuesWebhookLivenessProbe = {
  /**
   * @default 3
   */
  failureThreshold?: number;
  /**
   * @default 60
   */
  initialDelaySeconds?: number;
  /**
   * @default 10
   */
  periodSeconds?: number;
  /**
   * @default 1
   */
  successThreshold?: number;
  /**
   * @default 1
   */
  timeoutSeconds?: number;
};

export type CertmanagerHelmValuesWebhookReadinessProbe = {
  /**
   * @default 3
   */
  failureThreshold?: number;
  /**
   * @default 5
   */
  initialDelaySeconds?: number;
  /**
   * @default 5
   */
  periodSeconds?: number;
  /**
   * @default 1
   */
  successThreshold?: number;
  /**
   * @default 1
   */
  timeoutSeconds?: number;
};

export type CertmanagerHelmValuesWebhookNodeSelector = {
  /**
   * @default "linux"
   */
  "kubernetes.io/os"?: string;
};

export type CertmanagerHelmValuesWebhookAffinity = object;

export type CertmanagerHelmValuesWebhookPodLabels = object;

export type CertmanagerHelmValuesWebhookServiceLabels = object;

export type CertmanagerHelmValuesWebhookImage = {
  /**
   * The container registry to pull the webhook image from.
   * +docs:property
   * The container image for the cert-manager webhook
   * +docs:property
   *
   * @default "quay.io/jetstack/cert-manager-webhook"
   */
  repository?: string;
  /**
   * Override the image tag to deploy by setting this variable.
   * If no value is set, the chart's appVersion will be used.
   * +docs:property
   * Setting a digest will override any tag
   * +docs:property
   * digest: sha256:0e072dddd1f7f8fc8909a2ca6f65e76c5f0d2fcfb8be47935ae3457e8bbceb20
   * Kubernetes imagePullPolicy on Deployment.
   *
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
};

export type CertmanagerHelmValuesWebhookServiceAccount = {
  /**
   * Specifies whether a service account should be created.
   *
   * @default true
   */
  create?: boolean;
  /**
   * The name of the service account to use.
   * If not set and create is true, a name is generated using the fullname template.
   * +docs:property
   * Optional additional annotations to add to the webhook's Service Account.
   * +docs:property
   * Optional additional labels to add to the webhook's Service Account.
   * +docs:property
   * Automount API credentials for a Service Account.
   *
   * @default true
   */
  automountServiceAccountToken?: boolean;
};

export type CertmanagerHelmValuesWebhookUrl = object;

export type CertmanagerHelmValuesWebhookNetworkPolicy = {
  /**
   * Create network policies for the webhooks.
   *
   * @default false
   */
  enabled?: boolean;
  ingress?: CertmanagerHelmValuesWebhookNetworkPolicyIngressElement[];
  egress?: CertmanagerHelmValuesWebhookNetworkPolicyEgressElement[];
};

export type CertmanagerHelmValuesWebhookNetworkPolicyIngressElement = {
  from?: CertmanagerHelmValuesWebhookNetworkPolicyIngressFromElement[];
};

export type CertmanagerHelmValuesWebhookNetworkPolicyIngressFromElement = {
  /**
   * @default {"cidr":"0.0.0.0/0"}
   */
  ipBlock?: CertmanagerHelmValuesWebhookNetworkPolicyIngressFromIpBlock;
};

export type CertmanagerHelmValuesWebhookNetworkPolicyIngressFromIpBlock = {
  /**
   * @default "0.0.0.0/0"
   */
  cidr?: string;
};

export type CertmanagerHelmValuesWebhookNetworkPolicyEgressElement = {
  ports?: CertmanagerHelmValuesWebhookNetworkPolicyEgressPortsElement[];
  to?: CertmanagerHelmValuesWebhookNetworkPolicyEgressToElement[];
};

export type CertmanagerHelmValuesWebhookNetworkPolicyEgressPortsElement = {
  /**
   * @default 80
   */
  port?: number;
  /**
   * @default "TCP"
   */
  protocol?: string;
};

export type CertmanagerHelmValuesWebhookNetworkPolicyEgressToElement = {
  /**
   * @default {"cidr":"0.0.0.0/0"}
   */
  ipBlock?: CertmanagerHelmValuesWebhookNetworkPolicyEgressToIpBlock;
};

export type CertmanagerHelmValuesWebhookNetworkPolicyEgressToIpBlock = {
  /**
   * @default "0.0.0.0/0"
   */
  cidr?: string;
};

export type CertmanagerHelmValuesCainjector = {
  /**
   * Create the CA Injector deployment
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * The number of replicas of the cert-manager cainjector to run.
   * The default is 1, but in production set this to 2 or 3 to provide high
   * availability.
   * If `replicas > 1`, consider setting `cainjector.podDisruptionBudget.enabled=true`.
   * Note that cert-manager uses leader election to ensure that there can
   * only be a single instance active at a time.
   *
   * @default 1
   */
  replicaCount?: number;
  /**
   * @default {}
   */
  config?: CertmanagerHelmValuesCainjectorConfig;
  /**
   * @default {}
   */
  strategy?: CertmanagerHelmValuesCainjectorStrategy;
  /**
   * Pod Security Context to be set on the cainjector component Pod
   * For more information, see [Configure a Security Context for a Pod or Container](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/).
   * +docs:property
   *
   * @default {"runAsNonRoot":true,"seccompProfile":{"type":"RuntimeDefault"}}
   */
  securityContext?: CertmanagerHelmValuesCainjectorSecurityContext;
  /**
   * Container Security Context to be set on the cainjector component container
   * For more information, see [Configure a Security Context for a Pod or Container](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/).
   * +docs:property
   *
   * @default {"allowPrivilegeEscalation":false,"capabilities":{"drop":["ALL"]},"readOnlyRootFilesystem":true}
   */
  containerSecurityContext?: CertmanagerHelmValuesCainjectorContainerSecurityContext;
  /**
   * `minAvailable` configures the minimum available pods for disruptions. It can either be set to
   * an integer (e.g., 1) or a percentage value (e.g., 25%).
   * Cannot be used if `maxUnavailable` is set.
   * +docs:property
   * +docs:type=unknown
   * `maxUnavailable` configures the maximum unavailable pods for disruptions. It can either be set to
   * an integer (e.g., 1) or a percentage value (e.g., 25%).
   * Cannot be used if `minAvailable` is set.
   * +docs:property
   * +docs:type=unknown
   * Optional additional annotations to add to the cainjector Deployment.
   * +docs:property
   * Optional additional annotations to add to the cainjector Pods.
   * +docs:property
   * Optional additional annotations to add to the cainjector metrics Service.
   * +docs:property
   * Additional command line flags to pass to cert-manager cainjector binary.
   * To see all available flags run `docker run quay.io/jetstack/cert-manager-cainjector:<version> --help`.
   *
   * @default {"enabled":false}
   */
  podDisruptionBudget?: CertmanagerHelmValuesCainjectorPodDisruptionBudget;
  extraArgs?: unknown[];
  extraEnv?: unknown[];
  /**
   * Comma separated list of feature gates that should be enabled on the
   * cainjector pod.
   *
   * @default ""
   */
  featureGates?: string;
  /**
   * For more information, see [Resource Management for Pods and Containers](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/).
   *
   * @default {}
   */
  resources?: CertmanagerHelmValuesCainjectorResources;
  /**
   * The nodeSelector on Pods tells Kubernetes to schedule Pods on the nodes with
   * matching labels.
   * For more information, see [Assigning Pods to Nodes](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/).
   * This default ensures that Pods are only scheduled to Linux nodes.
   * It prevents Pods being scheduled to Windows nodes in a mixed OS cluster.
   * +docs:property
   *
   * @default {"kubernetes.io/os":"linux"}
   */
  nodeSelector?: CertmanagerHelmValuesCainjectorNodeSelector;
  /**
   * @default {}
   */
  affinity?: CertmanagerHelmValuesCainjectorAffinity;
  tolerations?: unknown[];
  topologySpreadConstraints?: unknown[];
  /**
   * Optional additional labels to add to the CA Injector Pods.
   *
   * @default {}
   */
  podLabels?: CertmanagerHelmValuesCainjectorPodLabels;
  /**
   * Optional additional labels to add to the CA Injector metrics Service.
   *
   * @default {}
   */
  serviceLabels?: CertmanagerHelmValuesCainjectorServiceLabels;
  /**
   * @default {"repository":"quay.io/jetstack/cert-manager-cainjector","pullPolicy":"IfNotPresent"}
   */
  image?: CertmanagerHelmValuesCainjectorImage;
  /**
   * @default {"create":true,"automountServiceAccountToken":true}
   */
  serviceAccount?: CertmanagerHelmValuesCainjectorServiceAccount;
  volumes?: unknown[];
  volumeMounts?: unknown[];
  /**
   * enableServiceLinks indicates whether information about services should be
   * injected into the pod's environment variables, matching the syntax of Docker
   * links.
   *
   * @default false
   */
  enableServiceLinks?: boolean;
};

export type CertmanagerHelmValuesCainjectorConfig = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type CertmanagerHelmValuesCainjectorStrategy = object;

export type CertmanagerHelmValuesCainjectorSecurityContext = {
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: CertmanagerHelmValuesCainjectorSecurityContextSeccompProfile;
};

export type CertmanagerHelmValuesCainjectorSecurityContextSeccompProfile = {
  /**
   * @default "RuntimeDefault"
   */
  type?: string;
};

export type CertmanagerHelmValuesCainjectorContainerSecurityContext = {
  /**
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: CertmanagerHelmValuesCainjectorContainerSecurityContextCapabilities;
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
};

export type CertmanagerHelmValuesCainjectorContainerSecurityContextCapabilities = {
  drop?: string[];
};

export type CertmanagerHelmValuesCainjectorPodDisruptionBudget = {
  /**
   * Enable or disable the PodDisruptionBudget resource.
   * This prevents downtime during voluntary disruptions such as during a Node upgrade.
   * For example, the PodDisruptionBudget will block `kubectl drain`
   * if it is used on the Node where the only remaining cert-manager
   * Pod is currently running.
   *
   * @default false
   */
  enabled?: boolean;
};

export type CertmanagerHelmValuesCainjectorResources = object;

export type CertmanagerHelmValuesCainjectorNodeSelector = {
  /**
   * @default "linux"
   */
  "kubernetes.io/os"?: string;
};

export type CertmanagerHelmValuesCainjectorAffinity = object;

export type CertmanagerHelmValuesCainjectorPodLabels = object;

export type CertmanagerHelmValuesCainjectorServiceLabels = object;

export type CertmanagerHelmValuesCainjectorImage = {
  /**
   * The container registry to pull the cainjector image from.
   * +docs:property
   * The container image for the cert-manager cainjector
   * +docs:property
   *
   * @default "quay.io/jetstack/cert-manager-cainjector"
   */
  repository?: string;
  /**
   * Override the image tag to deploy by setting this variable.
   * If no value is set, the chart's appVersion will be used.
   * +docs:property
   * Setting a digest will override any tag.
   * +docs:property
   * digest: sha256:0e072dddd1f7f8fc8909a2ca6f65e76c5f0d2fcfb8be47935ae3457e8bbceb20
   * Kubernetes imagePullPolicy on Deployment.
   *
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
};

export type CertmanagerHelmValuesCainjectorServiceAccount = {
  /**
   * Specifies whether a service account should be created.
   *
   * @default true
   */
  create?: boolean;
  /**
   * The name of the service account to use.
   * If not set and create is true, a name is generated using the fullname template
   * +docs:property
   * Optional additional annotations to add to the cainjector's Service Account.
   * +docs:property
   * Optional additional labels to add to the cainjector's Service Account.
   * +docs:property
   * Automount API credentials for a Service Account.
   *
   * @default true
   */
  automountServiceAccountToken?: boolean;
};

export type CertmanagerHelmValuesAcmesolver = {
  /**
   * @default {"repository":"quay.io/jetstack/cert-manager-acmesolver","pullPolicy":"IfNotPresent"}
   */
  image?: CertmanagerHelmValuesAcmesolverImage;
};

export type CertmanagerHelmValuesAcmesolverImage = {
  /**
   * The container registry to pull the acmesolver image from.
   * +docs:property
   * The container image for the cert-manager acmesolver.
   * +docs:property
   *
   * @default "quay.io/jetstack/cert-manager-acmesolver"
   */
  repository?: string;
  /**
   * Override the image tag to deploy by setting this variable.
   * If no value is set, the chart's appVersion is used.
   * +docs:property
   * Setting a digest will override any tag.
   * +docs:property
   * digest: sha256:0e072dddd1f7f8fc8909a2ca6f65e76c5f0d2fcfb8be47935ae3457e8bbceb20
   * Kubernetes imagePullPolicy on Deployment.
   *
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
};

export type CertmanagerHelmValuesStartupapicheck = {
  /**
   * Enables the startup api check.
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Pod Security Context to be set on the startupapicheck component Pod.
   * For more information, see [Configure a Security Context for a Pod or Container](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/).
   * +docs:property
   *
   * @default {"runAsNonRoot":true,"seccompProfile":{"type":"RuntimeDefault"}}
   */
  securityContext?: CertmanagerHelmValuesStartupapicheckSecurityContext;
  /**
   * Container Security Context to be set on the controller component container.
   * For more information, see [Configure a Security Context for a Pod or Container](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/).
   * +docs:property
   *
   * @default {"allowPrivilegeEscalation":false,"capabilities":{"drop":["ALL"]},"readOnlyRootFilesystem":true}
   */
  containerSecurityContext?: CertmanagerHelmValuesStartupapicheckContainerSecurityContext;
  /**
   * Timeout for 'kubectl check api' command.
   *
   * @default "1m"
   */
  timeout?: string;
  /**
   * Job backoffLimit
   *
   * @default 4
   */
  backoffLimit?: number;
  /**
   * Optional additional annotations to add to the startupapicheck Job.
   * +docs:property
   *
   * @default {"helm.sh/hook":"post-install","helm.sh/hook-weight":"1","helm.sh/hook-delete-policy":"before-hook-creation,hook-succeeded"}
   */
  jobAnnotations?: CertmanagerHelmValuesStartupapicheckJobAnnotations;
  extraArgs?: string[];
  extraEnv?: unknown[];
  /**
   * For more information, see [Resource Management for Pods and Containers](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/).
   *
   * @default {}
   */
  resources?: CertmanagerHelmValuesStartupapicheckResources;
  /**
   * The nodeSelector on Pods tells Kubernetes to schedule Pods on the nodes with
   * matching labels.
   * For more information, see [Assigning Pods to Nodes](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/).
   * This default ensures that Pods are only scheduled to Linux nodes.
   * It prevents Pods being scheduled to Windows nodes in a mixed OS cluster.
   * +docs:property
   *
   * @default {"kubernetes.io/os":"linux"}
   */
  nodeSelector?: CertmanagerHelmValuesStartupapicheckNodeSelector;
  /**
   * @default {}
   */
  affinity?: CertmanagerHelmValuesStartupapicheckAffinity;
  tolerations?: unknown[];
  /**
   * Optional additional labels to add to the startupapicheck Pods.
   *
   * @default {}
   */
  podLabels?: CertmanagerHelmValuesStartupapicheckPodLabels;
  /**
   * @default {"repository":"quay.io/jetstack/cert-manager-startupapicheck","pullPolicy":"IfNotPresent"}
   */
  image?: CertmanagerHelmValuesStartupapicheckImage;
  /**
   * @default {"annotations":{"helm.sh/hook":"post-install","helm.sh/hook-weight":"-5","helm.sh/hook-delete-policy":"before-hook-creation,hook-succeeded"}}
   */
  rbac?: CertmanagerHelmValuesStartupapicheckRbac;
  /**
   * Automounting API credentials for a particular pod.
   * +docs:property
   * Optional additional labels to add to the startupapicheck's Service Account.
   * +docs:property
   * Additional volumes to add to the cert-manager controller pod.
   *
   * @default {"create":true,"annotations":{"helm.sh/hook":"post-install","helm.sh/hook-weight":"-5","helm.sh/hook-delete-policy":"before-hook-creation,hook-succeeded"},"automountServiceAccountToken":true}
   */
  serviceAccount?: CertmanagerHelmValuesStartupapicheckServiceAccount;
  volumes?: unknown[];
  volumeMounts?: unknown[];
  /**
   * enableServiceLinks indicates whether information about services should be
   * injected into pod's environment variables, matching the syntax of Docker
   * links.
   *
   * @default false
   */
  enableServiceLinks?: boolean;
};

export type CertmanagerHelmValuesStartupapicheckSecurityContext = {
  /**
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: CertmanagerHelmValuesStartupapicheckSecurityContextSeccompProfile;
};

export type CertmanagerHelmValuesStartupapicheckSecurityContextSeccompProfile = {
  /**
   * @default "RuntimeDefault"
   */
  type?: string;
};

export type CertmanagerHelmValuesStartupapicheckContainerSecurityContext = {
  /**
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
  /**
   * @default {"drop":["ALL"]}
   */
  capabilities?: CertmanagerHelmValuesStartupapicheckContainerSecurityContextCapabilities;
  /**
   * @default true
   */
  readOnlyRootFilesystem?: boolean;
};

export type CertmanagerHelmValuesStartupapicheckContainerSecurityContextCapabilities = {
  drop?: string[];
};

export type CertmanagerHelmValuesStartupapicheckJobAnnotations = {
  /**
   * @default "post-install"
   */
  "helm.sh/hook"?: string;
  /**
   * @default "1"
   */
  "helm.sh/hook-weight"?: number;
  /**
   * @default "before-hook-creation,hook-succeeded"
   */
  "helm.sh/hook-delete-policy"?: string;
};

export type CertmanagerHelmValuesStartupapicheckResources = object;

export type CertmanagerHelmValuesStartupapicheckNodeSelector = {
  /**
   * @default "linux"
   */
  "kubernetes.io/os"?: string;
};

export type CertmanagerHelmValuesStartupapicheckAffinity = object;

export type CertmanagerHelmValuesStartupapicheckPodLabels = object;

export type CertmanagerHelmValuesStartupapicheckImage = {
  /**
   * The container registry to pull the startupapicheck image from.
   * +docs:property
   * The container image for the cert-manager startupapicheck.
   * +docs:property
   *
   * @default "quay.io/jetstack/cert-manager-startupapicheck"
   */
  repository?: string;
  /**
   * Override the image tag to deploy by setting this variable.
   * If no value is set, the chart's appVersion is used.
   * +docs:property
   * Setting a digest will override any tag.
   * +docs:property
   * digest: sha256:0e072dddd1f7f8fc8909a2ca6f65e76c5f0d2fcfb8be47935ae3457e8bbceb20
   * Kubernetes imagePullPolicy on Deployment.
   *
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
};

export type CertmanagerHelmValuesStartupapicheckRbac = {
  /**
   * annotations for the startup API Check job RBAC and PSP resources.
   * +docs:property
   *
   * @default {"helm.sh/hook":"post-install","helm.sh/hook-weight":"-5","helm.sh/hook-delete-policy":"before-hook-creation,hook-succeeded"}
   */
  annotations?: CertmanagerHelmValuesStartupapicheckRbacAnnotations;
};

export type CertmanagerHelmValuesStartupapicheckRbacAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default "post-install"
   */
  "helm.sh/hook"?: string;
  /**
   * @default "-5"
   */
  "helm.sh/hook-weight"?: number;
  /**
   * @default "before-hook-creation,hook-succeeded"
   */
  "helm.sh/hook-delete-policy"?: string;
};

export type CertmanagerHelmValuesStartupapicheckServiceAccount = {
  /**
   * Specifies whether a service account should be created.
   *
   * @default true
   */
  create?: boolean;
  /**
   * The name of the service account to use.
   * If not set and create is true, a name is generated using the fullname template.
   * +docs:property
   * Optional additional annotations to add to the Job's Service Account.
   * +docs:property
   *
   * @default {"helm.sh/hook":"post-install","helm.sh/hook-weight":"-5","helm.sh/hook-delete-policy":"before-hook-creation,hook-succeeded"}
   */
  annotations?: CertmanagerHelmValuesStartupapicheckServiceAccountAnnotations;
  /**
   * Automount API credentials for a Service Account.
   * +docs:property
   *
   * @default true
   */
  automountServiceAccountToken?: boolean;
};

export type CertmanagerHelmValuesStartupapicheckServiceAccountAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
  /**
   * @default "post-install"
   */
  "helm.sh/hook"?: string;
  /**
   * @default "-5"
   */
  "helm.sh/hook-weight"?: number;
  /**
   * @default "before-hook-creation,hook-succeeded"
   */
  "helm.sh/hook-delete-policy"?: string;
};

export type CertmanagerHelmValues = {
  /**
   * +docs:section=Global
   * Default values for cert-manager.
   * This is a YAML-formatted file.
   * Declare variables to be passed into your templates.
   *
   * @default {...} (8 keys)
   */
  global?: CertmanagerHelmValuesGlobal;
  /**
   * This option is equivalent to setting crds.enabled=true and crds.keep=true.
   * Deprecated: use crds.enabled and crds.keep instead.
   *
   * @default false
   */
  installCRDs?: boolean;
  /**
   * @default {"enabled":false,"keep":true}
   */
  crds?: CertmanagerHelmValuesCrds;
  /**
   * +docs:section=Controller
   * The number of replicas of the cert-manager controller to run.
   * The default is 1, but in production set this to 2 or 3 to provide high
   * availability.
   * If `replicas > 1`, consider setting `podDisruptionBudget.enabled=true`.
   * Note that cert-manager uses leader election to ensure that there can
   * only be a single instance active at a time.
   *
   * @default 1
   */
  replicaCount?: number;
  /**
   * Deployment update strategy for the cert-manager controller deployment.
   * For more information, see the [Kubernetes documentation](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/#strategy).
   * For example:
   *
   * @default {}
   */
  strategy?: CertmanagerHelmValuesStrategy;
  /**
   * This configures the minimum available pods for disruptions. It can either be set to
   * an integer (e.g., 1) or a percentage value (e.g., 25%).
   * It cannot be used if `maxUnavailable` is set.
   * +docs:property
   * +docs:type=unknown
   * This configures the maximum unavailable pods for disruptions. It can either be set to
   * an integer (e.g., 1) or a percentage value (e.g., 25%).
   * it cannot be used if `minAvailable` is set.
   * +docs:property
   * +docs:type=unknown
   * A comma-separated list of feature gates that should be enabled on the
   * controller pod.
   *
   * @default {"enabled":false}
   */
  podDisruptionBudget?: CertmanagerHelmValuesPodDisruptionBudget;
  /**
   * Comma separated list of feature gates that should be enabled on the
   * cainjector pod.
   *
   * @default ""
   */
  featureGates?: string;
  /**
   * The maximum number of challenges that can be scheduled as 'processing' at once.
   *
   * @default 60
   */
  maxConcurrentChallenges?: number;
  /**
   * @default {"repository":"quay.io/jetstack/cert-manager-controller","pullPolicy":"IfNotPresent"}
   */
  image?: CertmanagerHelmValuesImage;
  /**
   * Override the namespace used to store DNS provider credentials etc. for ClusterIssuer
   * resources. By default, the same namespace as cert-manager is deployed within is
   * used. This namespace will not be automatically created by the Helm chart.
   *
   * @default ""
   */
  clusterResourceNamespace?: string;
  /**
   * This namespace allows you to define where the services are installed into.
   * If not set then they use the namespace of the release.
   * This is helpful when installing cert manager as a chart dependency (sub chart).
   *
   * @default ""
   */
  namespace?: string;
  /**
   * Override the "cert-manager.fullname" value. This value is used as part of
   * most of the names of the resources created by this Helm chart.
   * +docs:property
   * Override the "cert-manager.name" value, which is used to annotate some of
   * the resources that are created by this Chart (using "app.kubernetes.io/name").
   * NOTE: There are some inconsistencies in the Helm chart when it comes to
   * these annotations (some resources use, e.g., "cainjector.name" which resolves
   * to the value "cainjector").
   * +docs:property
   *
   * @default {"create":true,"automountServiceAccountToken":true}
   */
  serviceAccount?: CertmanagerHelmValuesServiceAccount;
  /**
   * Automounting API credentials for a particular pod.
   * +docs:property
   * When this flag is enabled, secrets will be automatically removed when the certificate resource is deleted.
   *
   * @default false
   */
  enableCertificateOwnerRef?: boolean;
  /**
   * This property is used to configure options for the controller pod.
   * This allows setting options that would usually be provided using flags.
   * If `apiVersion` and `kind` are unspecified they default to the current latest
   * version (currently `controller.config.cert-manager.io/v1alpha1`). You can pin
   * the version by specifying the `apiVersion` yourself.
   * For example:
   * Feature gates as of v1.18.1. Listed with their default values.
   * See https://cert-manager.io/docs/cli/controller/
   * AdditionalCertificateOutputFormats: true # GA - default=true
   * AllAlpha: false # ALPHA - default=false
   * AllBeta: false # BETA - default=false
   * ExperimentalCertificateSigningRequestControllers: false # ALPHA - default=false
   * ExperimentalGatewayAPISupport: true # BETA - default=true
   * LiteralCertificateSubject: true # BETA - default=true
   * NameConstraints: true # BETA - default=true
   * OtherNames: false # ALPHA - default=false
   * SecretsFilteredCaching: true # BETA - default=true
   * ServerSideApply: false # ALPHA - default=false
   * StableCertificateRequestName: true # BETA - default=true
   * UseCertificateRequestBasicConstraints: false # ALPHA - default=false
   * UseDomainQualifiedFinalizer: true # GA - default=true
   * ValidateCAA: false # ALPHA - default=false
   * DefaultPrivateKeyRotationPolicyAlways: true # BETA - default=true
   * ACMEHTTP01IngressPathTypeExact: true # BETA - default=true
   * Configure the metrics server for TLS
   * See https://cert-manager.io/docs/devops-tips/prometheus-metrics/#tls
   *
   * @default {}
   */
  config?: CertmanagerHelmValuesConfig;
  /**
   * Setting Nameservers for DNS01 Self Check.
   * For more information, see the [cert-manager documentation](https://cert-manager.io/docs/configuration/acme/dns01/#setting-nameservers-for-dns01-self-check).
   * A comma-separated string with the host and port of the recursive nameservers cert-manager should query.
   *
   * @default ""
   */
  dns01RecursiveNameservers?: string;
  /**
   * Forces cert-manager to use only the recursive nameservers for verification.
   * Enabling this option could cause the DNS01 self check to take longer owing to caching performed by the recursive nameservers.
   *
   * @default false
   */
  dns01RecursiveNameserversOnly?: boolean;
  /**
   * Option to disable cert-manager's build-in auto-approver. The auto-approver
   * approves all CertificateRequests that reference issuers matching the 'approveSignerNames'
   * option. This 'disableAutoApproval' option is useful when you want to make all approval decisions
   * using a different approver (like approver-policy - https://github.com/cert-manager/approver-policy).
   *
   * @default false
   */
  disableAutoApproval?: boolean;
  approveSignerNames?: string[];
  extraArgs?: unknown[];
  extraEnv?: unknown[];
  /**
   * Resources to provide to the cert-manager controller pod.
   * For example:
   * For more information, see [Resource Management for Pods and Containers](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/).
   *
   * @default {}
   */
  resources?: CertmanagerHelmValuesResources;
  /**
   * Pod Security Context.
   * For more information, see [Configure a Security Context for a Pod or Container](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/).
   * +docs:property
   *
   * @default {"runAsNonRoot":true,"seccompProfile":{"type":"RuntimeDefault"}}
   */
  securityContext?: CertmanagerHelmValuesSecurityContext;
  /**
   * Container Security Context to be set on the controller component container.
   * For more information, see [Configure a Security Context for a Pod or Container](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/).
   * +docs:property
   *
   * @default {"allowPrivilegeEscalation":false,"capabilities":{"drop":["ALL"]},"readOnlyRootFilesystem":true}
   */
  containerSecurityContext?: CertmanagerHelmValuesContainerSecurityContext;
  volumes?: unknown[];
  volumeMounts?: unknown[];
  /**
   * Optional additional annotations to add to the controller Deployment.
   * +docs:property
   * Optional additional annotations to add to the controller Pods.
   * +docs:property
   * Optional additional labels to add to the controller Pods.
   *
   * @default {}
   */
  podLabels?: CertmanagerHelmValuesPodLabels;
  hostAliases?: unknown[];
  /**
   * The nodeSelector on Pods tells Kubernetes to schedule Pods on the nodes with
   * matching labels.
   * For more information, see [Assigning Pods to Nodes](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/).
   * This default ensures that Pods are only scheduled to Linux nodes.
   * It prevents Pods being scheduled to Windows nodes in a mixed OS cluster.
   * +docs:property
   *
   * @default {"kubernetes.io/os":"linux"}
   */
  nodeSelector?: CertmanagerHelmValuesNodeSelector;
  /**
   * +docs:ignore
   * Optional default issuer to use for ingress resources.
   * +docs:property=ingressShim.defaultIssuerName
   * Optional default issuer kind to use for ingress resources.
   * +docs:property=ingressShim.defaultIssuerKind
   * Optional default issuer group to use for ingress resources.
   * +docs:property=ingressShim.defaultIssuerGroup
   *
   * @default {}
   */
  ingressShim?: CertmanagerHelmValuesIngressShim;
  /**
   * Use these variables to configure the HTTP_PROXY environment variables.
   * Configures the HTTP_PROXY environment variable where a HTTP proxy is required.
   * +docs:property
   * http_proxy: "http://proxy:8080"
   * Configures the HTTPS_PROXY environment variable where a HTTP proxy is required.
   * +docs:property
   * https_proxy: "https://proxy:8080"
   * Configures the NO_PROXY environment variable where a HTTP proxy is required,
   * but certain domains should be excluded.
   * +docs:property
   * A Kubernetes Affinity, if required. For more information, see [Affinity v1 core](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.27/#affinity-v1-core).
   * For example:
   *
   * @default {}
   */
  affinity?: CertmanagerHelmValuesAffinity;
  tolerations?: unknown[];
  topologySpreadConstraints?: unknown[];
  /**
   * LivenessProbe settings for the controller container of the controller Pod.
   * This is enabled by default, in order to enable the clock-skew liveness probe that
   * restarts the controller in case of a skew between the system clock and the monotonic clock.
   * LivenessProbe durations and thresholds are based on those used for the Kubernetes
   * controller-manager. For more information see the following on the
   * [Kubernetes GitHub repository](https://github.com/kubernetes/kubernetes/blob/806b30170c61a38fedd54cc9ede4cd6275a1ad3b/cmd/kubeadm/app/util/staticpod/utils.go#L241-L245)
   * +docs:property
   *
   * @default {...} (6 keys)
   */
  livenessProbe?: CertmanagerHelmValuesLivenessProbe;
  /**
   * enableServiceLinks indicates whether information about services should be
   * injected into the pod's environment variables, matching the syntax of Docker
   * links.
   *
   * @default false
   */
  enableServiceLinks?: boolean;
  /**
   * +docs:section=Prometheus
   *
   * @default {"enabled":true,"servicemonitor":{"enabled":false,"prometheusInstance":"default","targetPort":"http-metrics","path":"/metrics","interval":"60s","scrapeTimeout":"30s","labels":{},"annotations":{},"honorLabels":false,"endpointAdditionalProperties":{}},"podmonitor":{"enabled":false,"prometheusInstance":"default","path":"/metrics","interval":"60s","scrapeTimeout":"30s","labels":{},"annotations":{},"honorLabels":false,"endpointAdditionalProperties":{}}}
   */
  prometheus?: CertmanagerHelmValuesPrometheus;
  /**
   * +docs:section=Webhook
   *
   * @default {...} (33 keys)
   */
  webhook?: CertmanagerHelmValuesWebhook;
  /**
   * +docs:section=CA Injector
   *
   * @default {...} (22 keys)
   */
  cainjector?: CertmanagerHelmValuesCainjector;
  /**
   * +docs:section=ACME Solver
   *
   * @default {"image":{"repository":"quay.io/jetstack/cert-manager-acmesolver","pullPolicy":"IfNotPresent"}}
   */
  acmesolver?: CertmanagerHelmValuesAcmesolver;
  /**
   * +docs:section=Startup API Check
   * This startupapicheck is a Helm post-install hook that waits for the webhook
   * endpoints to become available.
   * The check is implemented using a Kubernetes Job - if you are injecting mesh
   * sidecar proxies into cert-manager pods, ensure that they
   * are not injected into this Job's pod. Otherwise, the installation may time out
   * owing to the Job never being completed because the sidecar proxy does not exit.
   * For more information, see [this note](https://github.com/cert-manager/cert-manager/pull/4414).
   *
   * @default {...} (19 keys)
   */
  startupapicheck?: CertmanagerHelmValuesStartupapicheck;
  extraObjects?: unknown[];
  /**
   * Field used by our release pipeline to produce the static manifests.
   * The field defaults to "helm" but is set to "static" when we render
   * the static YAML manifests.
   * +docs:hidden
   *
   * @default "helm"
   */
  creator?: string;
  /**
   * Field that can be used as a condition when cert-manager is a dependency.
   * This definition is only here as a placeholder such that it is included in
   * the json schema.
   * See https://helm.sh/docs/chart_best_practices/dependencies/#conditions-and-tags
   * for more info.
   * +docs:hidden
   *
   * @default true
   */
  enabled?: boolean;
};

export type CertmanagerHelmParameters = {
  "global.imagePullSecrets"?: string;
  "global.priorityClassName"?: string;
  "global.rbac.create"?: string;
  "global.rbac.aggregateClusterRoles"?: string;
  "global.podSecurityPolicy.enabled"?: string;
  "global.podSecurityPolicy.useAppArmor"?: string;
  "global.logLevel"?: string;
  "global.leaderElection.namespace"?: string;
  installCRDs?: string;
  "crds.enabled"?: string;
  "crds.keep"?: string;
  replicaCount?: string;
  "podDisruptionBudget.enabled"?: string;
  featureGates?: string;
  maxConcurrentChallenges?: string;
  "image.repository"?: string;
  "image.pullPolicy"?: string;
  clusterResourceNamespace?: string;
  namespace?: string;
  "serviceAccount.create"?: string;
  "serviceAccount.automountServiceAccountToken"?: string;
  enableCertificateOwnerRef?: string;
  dns01RecursiveNameservers?: string;
  dns01RecursiveNameserversOnly?: string;
  disableAutoApproval?: string;
  approveSignerNames?: string;
  extraArgs?: string;
  extraEnv?: string;
  "securityContext.runAsNonRoot"?: string;
  "securityContext.seccompProfile.type"?: string;
  "containerSecurityContext.allowPrivilegeEscalation"?: string;
  "containerSecurityContext.capabilities.drop"?: string;
  "containerSecurityContext.readOnlyRootFilesystem"?: string;
  volumes?: string;
  volumeMounts?: string;
  hostAliases?: string;
  "nodeSelector.kubernetes.io/os"?: string;
  tolerations?: string;
  topologySpreadConstraints?: string;
  "livenessProbe.enabled"?: string;
  "livenessProbe.initialDelaySeconds"?: string;
  "livenessProbe.periodSeconds"?: string;
  "livenessProbe.timeoutSeconds"?: string;
  "livenessProbe.successThreshold"?: string;
  "livenessProbe.failureThreshold"?: string;
  enableServiceLinks?: string;
  "prometheus.enabled"?: string;
  "prometheus.servicemonitor.enabled"?: string;
  "prometheus.servicemonitor.prometheusInstance"?: string;
  "prometheus.servicemonitor.targetPort"?: string;
  "prometheus.servicemonitor.path"?: string;
  "prometheus.servicemonitor.interval"?: string;
  "prometheus.servicemonitor.scrapeTimeout"?: string;
  "prometheus.servicemonitor.honorLabels"?: string;
  "prometheus.podmonitor.enabled"?: string;
  "prometheus.podmonitor.prometheusInstance"?: string;
  "prometheus.podmonitor.path"?: string;
  "prometheus.podmonitor.interval"?: string;
  "prometheus.podmonitor.scrapeTimeout"?: string;
  "prometheus.podmonitor.honorLabels"?: string;
  "webhook.replicaCount"?: string;
  "webhook.timeoutSeconds"?: string;
  "webhook.securityContext.runAsNonRoot"?: string;
  "webhook.securityContext.seccompProfile.type"?: string;
  "webhook.containerSecurityContext.allowPrivilegeEscalation"?: string;
  "webhook.containerSecurityContext.capabilities.drop"?: string;
  "webhook.containerSecurityContext.readOnlyRootFilesystem"?: string;
  "webhook.podDisruptionBudget.enabled"?: string;
  "webhook.validatingWebhookConfiguration.namespaceSelector.matchExpressions.key"?: string;
  "webhook.validatingWebhookConfiguration.namespaceSelector.matchExpressions.operator"?: string;
  "webhook.validatingWebhookConfiguration.namespaceSelector.matchExpressions.values"?: string;
  "webhook.extraArgs"?: string;
  "webhook.extraEnv"?: string;
  "webhook.featureGates"?: string;
  "webhook.livenessProbe.failureThreshold"?: string;
  "webhook.livenessProbe.initialDelaySeconds"?: string;
  "webhook.livenessProbe.periodSeconds"?: string;
  "webhook.livenessProbe.successThreshold"?: string;
  "webhook.livenessProbe.timeoutSeconds"?: string;
  "webhook.readinessProbe.failureThreshold"?: string;
  "webhook.readinessProbe.initialDelaySeconds"?: string;
  "webhook.readinessProbe.periodSeconds"?: string;
  "webhook.readinessProbe.successThreshold"?: string;
  "webhook.readinessProbe.timeoutSeconds"?: string;
  "webhook.nodeSelector.kubernetes.io/os"?: string;
  "webhook.tolerations"?: string;
  "webhook.topologySpreadConstraints"?: string;
  "webhook.serviceIPFamilyPolicy"?: string;
  "webhook.serviceIPFamilies"?: string;
  "webhook.image.repository"?: string;
  "webhook.image.pullPolicy"?: string;
  "webhook.serviceAccount.create"?: string;
  "webhook.serviceAccount.automountServiceAccountToken"?: string;
  "webhook.securePort"?: string;
  "webhook.hostNetwork"?: string;
  "webhook.serviceType"?: string;
  "webhook.networkPolicy.enabled"?: string;
  "webhook.networkPolicy.ingress.from.ipBlock.cidr"?: string;
  "webhook.networkPolicy.egress.ports.port"?: string;
  "webhook.networkPolicy.egress.ports.protocol"?: string;
  "webhook.networkPolicy.egress.to.ipBlock.cidr"?: string;
  "webhook.volumes"?: string;
  "webhook.volumeMounts"?: string;
  "webhook.enableServiceLinks"?: string;
  "cainjector.enabled"?: string;
  "cainjector.replicaCount"?: string;
  "cainjector.securityContext.runAsNonRoot"?: string;
  "cainjector.securityContext.seccompProfile.type"?: string;
  "cainjector.containerSecurityContext.allowPrivilegeEscalation"?: string;
  "cainjector.containerSecurityContext.capabilities.drop"?: string;
  "cainjector.containerSecurityContext.readOnlyRootFilesystem"?: string;
  "cainjector.podDisruptionBudget.enabled"?: string;
  "cainjector.extraArgs"?: string;
  "cainjector.extraEnv"?: string;
  "cainjector.featureGates"?: string;
  "cainjector.nodeSelector.kubernetes.io/os"?: string;
  "cainjector.tolerations"?: string;
  "cainjector.topologySpreadConstraints"?: string;
  "cainjector.image.repository"?: string;
  "cainjector.image.pullPolicy"?: string;
  "cainjector.serviceAccount.create"?: string;
  "cainjector.serviceAccount.automountServiceAccountToken"?: string;
  "cainjector.volumes"?: string;
  "cainjector.volumeMounts"?: string;
  "cainjector.enableServiceLinks"?: string;
  "acmesolver.image.repository"?: string;
  "acmesolver.image.pullPolicy"?: string;
  "startupapicheck.enabled"?: string;
  "startupapicheck.securityContext.runAsNonRoot"?: string;
  "startupapicheck.securityContext.seccompProfile.type"?: string;
  "startupapicheck.containerSecurityContext.allowPrivilegeEscalation"?: string;
  "startupapicheck.containerSecurityContext.capabilities.drop"?: string;
  "startupapicheck.containerSecurityContext.readOnlyRootFilesystem"?: string;
  "startupapicheck.timeout"?: string;
  "startupapicheck.backoffLimit"?: string;
  "startupapicheck.jobAnnotations.helm.sh/hook"?: string;
  "startupapicheck.jobAnnotations.helm.sh/hook-weight"?: string;
  "startupapicheck.jobAnnotations.helm.sh/hook-delete-policy"?: string;
  "startupapicheck.extraArgs"?: string;
  "startupapicheck.extraEnv"?: string;
  "startupapicheck.nodeSelector.kubernetes.io/os"?: string;
  "startupapicheck.tolerations"?: string;
  "startupapicheck.image.repository"?: string;
  "startupapicheck.image.pullPolicy"?: string;
  "startupapicheck.rbac.annotations.helm.sh/hook"?: string;
  "startupapicheck.rbac.annotations.helm.sh/hook-weight"?: string;
  "startupapicheck.rbac.annotations.helm.sh/hook-delete-policy"?: string;
  "startupapicheck.serviceAccount.create"?: string;
  "startupapicheck.serviceAccount.annotations.helm.sh/hook"?: string;
  "startupapicheck.serviceAccount.annotations.helm.sh/hook-weight"?: string;
  "startupapicheck.serviceAccount.annotations.helm.sh/hook-delete-policy"?: string;
  "startupapicheck.serviceAccount.automountServiceAccountToken"?: string;
  "startupapicheck.volumes"?: string;
  "startupapicheck.volumeMounts"?: string;
  "startupapicheck.enableServiceLinks"?: string;
  extraObjects?: string;
  creator?: string;
  enabled?: string;
};
