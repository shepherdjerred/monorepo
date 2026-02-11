// Generated TypeScript types for coder Helm chart

export type CoderHelmValuesCoder = {
  env?: unknown[];
  envFrom?: unknown[];
  /**
   * coder.envUseClusterAccessURL -- Determines whether the CODER_ACCESS_URL env
   * is added to coder.env if it's not already set there. Set this to false if
   * defining CODER_ACCESS_URL in coder.envFrom to avoid conflicts.
   *
   * @default true
   */
  envUseClusterAccessURL?: boolean;
  /**
   * coder.image -- The image to use for Coder.
   * coder.initContainers -- Init containers for the deployment. See:
   * https://kubernetes.io/docs/concepts/workloads/pods/init-containers/
   *
   * @default {...} (4 keys)
   */
  image?: CoderHelmValuesCoderImage;
  initContainers?: unknown[];
  /**
   * coder.annotations -- The Deployment annotations. See:
   * https://kubernetes.io/docs/concepts/overview/working-with-objects/annotations/
   *
   * @default {}
   */
  annotations?: CoderHelmValuesCoderAnnotations;
  /**
   * coder.labels -- The Deployment labels. See:
   * https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/
   *
   * @default {}
   */
  labels?: CoderHelmValuesCoderLabels;
  /**
   * coder.podAnnotations -- The Coder pod annotations. See:
   * https://kubernetes.io/docs/concepts/overview/working-with-objects/annotations/
   *
   * @default {}
   */
  podAnnotations?: CoderHelmValuesCoderPodAnnotations;
  /**
   * coder.podLabels -- The Coder pod labels. See:
   * https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/
   *
   * @default {}
   */
  podLabels?: CoderHelmValuesCoderPodLabels;
  /**
   * coder.priorityClassName -- The priority class name to assign to the Coder pod. See:
   * https://kubernetes.io/docs/concepts/configuration/pod-priority-preemption/
   * The PriorityClass must exist in the cluster prior to deploying Coder with this set.
   *
   * @default ""
   */
  priorityClassName?: string;
  /**
   * coder.serviceAccount -- Configuration for the automatically created service
   * account. Creation of the service account cannot be disabled.
   *
   * @default {...} (7 keys)
   */
  serviceAccount?: CoderHelmValuesCoderServiceAccount;
  /**
   * coder.securityContext -- Fields related to the container's security
   * context (as opposed to the pod). Some fields are also present in the pod
   * security context, in which case these values will take precedence.
   *
   * @default {...} (6 keys)
   */
  securityContext?: CoderHelmValuesCoderSecurityContext;
  /**
   * coder.podSecurityContext -- Pod-level security context settings that apply
   * to all containers in the pod. This is useful for setting volume ownership
   * (fsGroup) when mounting secrets like TLS certificates. These settings are
   * applied at the pod level, while coder.securityContext applies at the
   * container level. Container-level settings take precedence over pod-level
   * settings for overlapping fields. This is opt-in and not set by default.
   * Common use case: Set fsGroup to ensure mounted secret volumes have correct
   * group ownership for the coder user to read certificate files.
   *
   * @default {}
   */
  podSecurityContext?: CoderHelmValuesCoderPodSecurityContext;
  volumes?: unknown[];
  volumeMounts?: unknown[];
  /**
   * coder.tls -- The TLS configuration for Coder.
   *
   * @default {"secretNames":[]}
   */
  tls?: CoderHelmValuesCoderTls;
  /**
   * coder.replicaCount -- The number of Kubernetes deployment replicas. This
   * should only be increased if High Availability is enabled.
   * This is an Enterprise feature. Contact sales@coder.com.
   *
   * @default 1
   */
  replicaCount?: number;
  /**
   * coder.workspaceProxy -- Whether or not this deployment of Coder is a Coder
   * Workspace Proxy. Workspace Proxies reduce the latency between the user and
   * their workspace for web connections (workspace apps and web terminal) and
   * proxied connections from the CLI. Workspace Proxies are optional and only
   * recommended for geographically sparse teams.
   * Make sure you set CODER_PRIMARY_ACCESS_URL and CODER_PROXY_SESSION_TOKEN in
   * the environment below. You can get a proxy token using the CLI:
   * coder wsproxy create \
   * name "proxy-name" \
   * display-name "Proxy Name" \
   * icon "/emojis/xyz.png"
   * This is an Enterprise feature. Contact sales@coder.com
   * Docs: https://coder.com/docs/admin/workspace-proxies
   *
   * @default false
   */
  workspaceProxy?: boolean;
  /**
   * coder.lifecycle -- container lifecycle handlers for the Coder container, allowing
   * for lifecycle events such as postStart and preStop events
   * See: https://kubernetes.io/docs/tasks/configure-pod-container/attach-handler-lifecycle-event/
   *
   * @default {}
   */
  lifecycle?: CoderHelmValuesCoderLifecycle;
  resources?: unknown;
  /**
   * coder.readinessProbe -- Readiness probe configuration for the Coder container.
   *
   * @default {"initialDelaySeconds":0}
   */
  readinessProbe?: CoderHelmValuesCoderReadinessProbe;
  /**
   * coder.livenessProbe -- Liveness probe configuration for the Coder container.
   *
   * @default {"initialDelaySeconds":0}
   */
  livenessProbe?: CoderHelmValuesCoderLivenessProbe;
  /**
   * coder.certs -- CA bundles to mount inside the Coder pod.
   *
   * @default {"secrets":[]}
   */
  certs?: CoderHelmValuesCoderCerts;
  /**
   * coder.affinity -- Allows specifying an affinity rule for the `coder` deployment.
   * The default rule prefers to schedule coder pods on different
   * nodes, which is only applicable if coder.replicaCount is greater than 1.
   *
   * @default {"podAntiAffinity":{"preferredDuringSchedulingIgnoredDuringExecution":[{"podAffinityTerm":{"labelSelector":{"matchExpressions":[{"key":"app.kubernetes.io/instance","operator":"In","values":["coder"]}]},"topologyKey":"kubernetes.io/hostname"},"weight":1}]}}
   */
  affinity?: CoderHelmValuesCoderAffinity;
  topologySpreadConstraints?: unknown;
  tolerations?: unknown[];
  /**
   * coder.nodeSelector -- Node labels for constraining coder pods to nodes.
   * See: https://kubernetes.io/docs/concepts/configuration/assign-pod-node/#nodeselector
   *
   * @default {}
   */
  nodeSelector?: CoderHelmValuesCoderNodeSelector;
  /**
   * kubernetes.io/os: linux
   * coder.service -- The Service object to expose for Coder.
   *
   * @default {...} (9 keys)
   */
  service?: CoderHelmValuesCoderService;
  /**
   * coder.ingress -- The Ingress object to expose for Coder.
   *
   * @default {...} (6 keys)
   */
  ingress?: CoderHelmValuesCoderIngress;
  command?: string[];
  commandArgs?: unknown[];
};

export type CoderHelmValuesCoderImage = {
  /**
   * coder.image.repo -- The repository of the image.
   *
   * @default "ghcr.io/coder/coder"
   */
  repo?: string;
  /**
   * coder.image.tag -- The tag of the image, defaults to {{.Chart.AppVersion}}
   * if not set. If you're using the chart directly from git, the default
   * app version will not work and you'll need to set this value. The helm
   * chart helpfully fails quickly in this case.
   *
   * @default ""
   */
  tag?: string;
  /**
   * coder.image.pullPolicy -- The pull policy to use for the image. See:
   * https://kubernetes.io/docs/concepts/containers/images/#image-pull-policy
   *
   * @default "IfNotPresent"
   */
  pullPolicy?: string;
  pullSecrets?: unknown[];
};

export type CoderHelmValuesCoderAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type CoderHelmValuesCoderLabels = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type CoderHelmValuesCoderPodAnnotations = object;

export type CoderHelmValuesCoderPodLabels = object;

export type CoderHelmValuesCoderServiceAccount = {
  /**
   * coder.serviceAccount.workspacePerms -- Whether or not to grant the coder
   * service account permissions to manage workspaces. This includes
   * permission to manage pods and persistent volume claims in the deployment
   * namespace.
   * It is recommended to keep this on if you are using Kubernetes templates
   * within Coder.
   *
   * @default true
   */
  workspacePerms?: boolean;
  /**
   * Defaults to top-level setting
   *
   * @default true
   */
  enableDeployments?: boolean;
  extraRules?: unknown[];
  workspaceNamespaces?: unknown[];
  /**
   * coder.serviceAccount.annotations -- The Coder service account annotations.
   *
   * @default {}
   */
  annotations?: CoderHelmValuesCoderServiceAccountAnnotations;
  /**
   * coder.serviceAccount.name -- The service account name
   *
   * @default "coder"
   */
  name?: string;
  /**
   * coder.serviceAccount.disableCreate -- Whether to create the service account or use existing service account.
   *
   * @default false
   */
  disableCreate?: boolean;
};

export type CoderHelmValuesCoderServiceAccountAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type CoderHelmValuesCoderSecurityContext = {
  /**
   * coder.securityContext.runAsNonRoot -- Requires that the coder container
   * runs as an unprivileged user. If setting runAsUser to 0 (root), this
   * will need to be set to false.
   *
   * @default true
   */
  runAsNonRoot?: boolean;
  /**
   * coder.securityContext.runAsUser -- Sets the user id of the container.
   * For security reasons, we recommend using a non-root user.
   *
   * @default 1000
   */
  runAsUser?: number;
  /**
   * coder.securityContext.runAsGroup -- Sets the group id of the container.
   * For security reasons, we recommend using a non-root group.
   *
   * @default 1000
   */
  runAsGroup?: number;
  readOnlyRootFilesystem?: unknown;
  /**
   * coder.securityContext.seccompProfile -- Sets the seccomp profile for
   * the coder container.
   *
   * @default {"type":"RuntimeDefault"}
   */
  seccompProfile?: CoderHelmValuesCoderSecurityContextSeccompProfile;
  /**
   * coder.securityContext.allowPrivilegeEscalation -- Controls whether
   * the container can gain additional privileges, such as escalating to
   * root. It is recommended to leave this setting disabled in production.
   *
   * @default false
   */
  allowPrivilegeEscalation?: boolean;
};

export type CoderHelmValuesCoderSecurityContextSeccompProfile = {
  /**
   * @default "RuntimeDefault"
   */
  type?: string;
};

export type CoderHelmValuesCoderPodSecurityContext = object;

export type CoderHelmValuesCoderTls = {
  secretNames?: unknown[];
};

export type CoderHelmValuesCoderLifecycle = object;

export type CoderHelmValuesCoderReadinessProbe = {
  /**
   * coder.readinessProbe.initialDelaySeconds -- Number of seconds after the container
   * has started before readiness probes are initiated.
   *
   * @default 0
   */
  initialDelaySeconds?: number;
};

export type CoderHelmValuesCoderLivenessProbe = {
  /**
   * coder.livenessProbe.initialDelaySeconds -- Number of seconds after the container
   * has started before liveness probes are initiated.
   *
   * @default 0
   */
  initialDelaySeconds?: number;
};

export type CoderHelmValuesCoderCerts = {
  secrets?: unknown[];
};

export type CoderHelmValuesCoderAffinity = {
  /**
   * @default {"preferredDuringSchedulingIgnoredDuringExecution":[{"podAffinityTerm":{"labelSelector":{"matchExpressions":[{"key":"app.kubernetes.io/instance","operator":"In","values":["coder"]}]},"topologyKey":"kubernetes.io/hostname"},"weight":1}]}
   */
  podAntiAffinity?: CoderHelmValuesCoderAffinityPodAntiAffinity;
};

export type CoderHelmValuesCoderAffinityPodAntiAffinity = {
  preferredDuringSchedulingIgnoredDuringExecution?: CoderHelmValuesCoderAffinityPodAntiAffinityPreferredDuringSchedulingIgnoredDuringExecutionElement[];
};

export type CoderHelmValuesCoderAffinityPodAntiAffinityPreferredDuringSchedulingIgnoredDuringExecutionElement = {
  /**
   * @default {"labelSelector":{"matchExpressions":[{"key":"app.kubernetes.io/instance","operator":"In","values":["coder"]}]},"topologyKey":"kubernetes.io/hostname"}
   */
  podAffinityTerm?: CoderHelmValuesCoderAffinityPodAntiAffinityPreferredDuringSchedulingIgnoredDuringExecutionPodAffinityTerm;
  /**
   * @default 1
   */
  weight?: number;
};

export type CoderHelmValuesCoderAffinityPodAntiAffinityPreferredDuringSchedulingIgnoredDuringExecutionPodAffinityTerm =
  {
    /**
     * @default {"matchExpressions":[{"key":"app.kubernetes.io/instance","operator":"In","values":["coder"]}]}
     */
    labelSelector?: CoderHelmValuesCoderAffinityPodAntiAffinityPreferredDuringSchedulingIgnoredDuringExecutionPodAffinityTermLabelSelector;
    /**
     * @default "kubernetes.io/hostname"
     */
    topologyKey?: string;
  };

export type CoderHelmValuesCoderAffinityPodAntiAffinityPreferredDuringSchedulingIgnoredDuringExecutionPodAffinityTermLabelSelector =
  {
    matchExpressions?: CoderHelmValuesCoderAffinityPodAntiAffinityPreferredDuringSchedulingIgnoredDuringExecutionPodAffinityTermLabelSelectorMatchExpressionsElement[];
  };

export type CoderHelmValuesCoderAffinityPodAntiAffinityPreferredDuringSchedulingIgnoredDuringExecutionPodAffinityTermLabelSelectorMatchExpressionsElement =
  {
    /**
     * @default "app.kubernetes.io/instance"
     */
    key?: string;
    /**
     * @default "In"
     */
    operator?: string;
    values?: string[];
  };

export type CoderHelmValuesCoderNodeSelector = object;

export type CoderHelmValuesCoderService = {
  /**
   * coder.service.enable -- Whether to create the Service object.
   *
   * @default true
   */
  enable?: boolean;
  /**
   * coder.service.type -- The type of service to expose. See:
   * https://kubernetes.io/docs/concepts/services-networking/service/#publishing-services-service-types
   *
   * @default "LoadBalancer"
   */
  type?: string;
  /**
   * coder.service.sessionAffinity -- Must be set to ClientIP or None
   * AWS ELB does not support session stickiness based on ClientIP, so you must set this to None.
   * The error message you might see: "Unsupported load balancer affinity: ClientIP"
   * https://kubernetes.io/docs/reference/networking/virtual-ips/#session-affinity
   *
   * @default "None"
   */
  sessionAffinity?: string;
  /**
   * coder.service.externalTrafficPolicy -- The external traffic policy to use.
   * You may need to change this to "Local" to preserve the source IP address
   * in some situations.
   * https://kubernetes.io/docs/tasks/access-application-cluster/create-external-load-balancer/#preserving-the-client-source-ip
   *
   * @default "Cluster"
   */
  externalTrafficPolicy?: string;
  /**
   * coder.service.loadBalancerIP -- The IP address of the LoadBalancer. If not
   * specified, a new IP will be generated each time the load balancer is
   * recreated. It is recommended to manually create a static IP address in
   * your cloud and specify it here in production to avoid accidental IP
   * address changes.
   *
   * @default ""
   */
  loadBalancerIP?: string;
  /**
   * coder.service.loadBalancerClass -- The class name of the LoadBalancer. See:
   * https://kubernetes.io/docs/concepts/services-networking/service/#load-balancer-class
   *
   * @default ""
   */
  loadBalancerClass?: string;
  /**
   * coder.service.annotations -- The service annotations. See:
   * https://kubernetes.io/docs/concepts/services-networking/service/#internal-load-balancer
   *
   * @default {}
   */
  annotations?: CoderHelmValuesCoderServiceAnnotations;
  /**
   * coder.service.httpNodePort -- Enabled if coder.service.type is set to
   * NodePort or LoadBalancer. If not set, Kubernetes will allocate a port from the default
   * range, 30000-32767.
   *
   * @default ""
   */
  httpNodePort?: string;
  /**
   * coder.service.httpsNodePort -- Enabled if coder.service.type is set to
   * NodePort or LoadBalancer. If not set, Kubernetes will allocate a port from the default
   * range, 30000-32767.
   *
   * @default ""
   */
  httpsNodePort?: string;
};

export type CoderHelmValuesCoderServiceAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type CoderHelmValuesCoderIngress = {
  /**
   * coder.ingress.enable -- Whether to create the Ingress object. If using an
   * Ingress, we recommend not specifying coder.tls.secretNames as the Ingress
   * will handle TLS termination.
   *
   * @default false
   */
  enable?: boolean;
  /**
   * coder.ingress.className -- The name of the Ingress class to use.
   *
   * @default ""
   */
  className?: string;
  /**
   * coder.ingress.host -- The hostname to match on.
   * Be sure to also set CODER_ACCESS_URL within coder.env[]
   *
   * @default ""
   */
  host?: string;
  /**
   * coder.ingress.wildcardHost -- The wildcard hostname to match on. Should be
   * in the form "*.example.com" or "*-suffix.example.com". If you are using a
   * suffix after the wildcard, the suffix will be stripped from the created
   * ingress to ensure that it is a legal ingress host. Optional if not using
   * applications over subdomains.
   * Be sure to also set CODER_WILDCARD_ACCESS_URL within coder.env[]
   *
   * @default ""
   */
  wildcardHost?: string;
  /**
   * coder.ingress.annotations -- The ingress annotations.
   *
   * @default {}
   */
  annotations?: CoderHelmValuesCoderIngressAnnotations;
  /**
   * coder.ingress.tls -- The TLS configuration to use for the Ingress.
   *
   * @default {"enable":false,"secretName":"","wildcardSecretName":""}
   */
  tls?: CoderHelmValuesCoderIngressTls;
};

export type CoderHelmValuesCoderIngressAnnotations = {
  /**
   * This type allows arbitrary additional properties beyond those defined below.
   * This is common for config maps, custom settings, and extensible configurations.
   */
  [key: string]: unknown;
};

export type CoderHelmValuesCoderIngressTls = {
  /**
   * coder.ingress.tls.enable -- Whether to enable TLS on the Ingress.
   *
   * @default false
   */
  enable?: boolean;
  /**
   * coder.ingress.tls.secretName -- The name of the TLS secret to use.
   *
   * @default ""
   */
  secretName?: string;
  /**
   * coder.ingress.tls.wildcardSecretName -- The name of the TLS secret to
   * use for the wildcard host.
   *
   * @default ""
   */
  wildcardSecretName?: string;
};

export type CoderHelmValuesProvisionerDaemon = {
  /**
   * provisionerDaemon.pskSecretName -- The name of the Kubernetes secret that contains the
   * Pre-Shared Key (PSK) to use to authenticate external provisioner daemons with Coder.  The
   * secret must be in the same namespace as the Helm deployment, and contain an item called "psk"
   * which contains the pre-shared key.
   *
   * @default ""
   */
  pskSecretName?: string;
};

export type CoderHelmValues = {
  /**
   * coder -- Primary configuration for `coder server`.
   *
   * @default {...} (31 keys)
   */
  coder?: CoderHelmValuesCoder;
  /**
   * provisionerDaemon -- Configuration for external provisioner daemons.
   * This is an Enterprise feature. Contact sales@coder.com.
   *
   * @default {"pskSecretName":""}
   */
  provisionerDaemon?: CoderHelmValuesProvisionerDaemon;
  extraTemplates?: unknown;
};

export type CoderHelmParameters = {
  "coder.env"?: string;
  "coder.envFrom"?: string;
  "coder.envUseClusterAccessURL"?: string;
  "coder.image.repo"?: string;
  "coder.image.tag"?: string;
  "coder.image.pullPolicy"?: string;
  "coder.image.pullSecrets"?: string;
  "coder.initContainers"?: string;
  "coder.priorityClassName"?: string;
  "coder.serviceAccount.workspacePerms"?: string;
  "coder.serviceAccount.enableDeployments"?: string;
  "coder.serviceAccount.extraRules"?: string;
  "coder.serviceAccount.workspaceNamespaces"?: string;
  "coder.serviceAccount.name"?: string;
  "coder.serviceAccount.disableCreate"?: string;
  "coder.securityContext.runAsNonRoot"?: string;
  "coder.securityContext.runAsUser"?: string;
  "coder.securityContext.runAsGroup"?: string;
  "coder.securityContext.readOnlyRootFilesystem"?: string;
  "coder.securityContext.seccompProfile.type"?: string;
  "coder.securityContext.allowPrivilegeEscalation"?: string;
  "coder.volumes"?: string;
  "coder.volumeMounts"?: string;
  "coder.tls.secretNames"?: string;
  "coder.replicaCount"?: string;
  "coder.workspaceProxy"?: string;
  "coder.resources"?: string;
  "coder.readinessProbe.initialDelaySeconds"?: string;
  "coder.livenessProbe.initialDelaySeconds"?: string;
  "coder.certs.secrets"?: string;
  "coder.affinity.podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution.podAffinityTerm.labelSelector.matchExpressions.key"?: string;
  "coder.affinity.podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution.podAffinityTerm.labelSelector.matchExpressions.operator"?: string;
  "coder.affinity.podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution.podAffinityTerm.labelSelector.matchExpressions.values"?: string;
  "coder.affinity.podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution.podAffinityTerm.topologyKey"?: string;
  "coder.affinity.podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution.weight"?: string;
  "coder.topologySpreadConstraints"?: string;
  "coder.tolerations"?: string;
  "coder.service.enable"?: string;
  "coder.service.type"?: string;
  "coder.service.sessionAffinity"?: string;
  "coder.service.externalTrafficPolicy"?: string;
  "coder.service.loadBalancerIP"?: string;
  "coder.service.loadBalancerClass"?: string;
  "coder.service.httpNodePort"?: string;
  "coder.service.httpsNodePort"?: string;
  "coder.ingress.enable"?: string;
  "coder.ingress.className"?: string;
  "coder.ingress.host"?: string;
  "coder.ingress.wildcardHost"?: string;
  "coder.ingress.tls.enable"?: string;
  "coder.ingress.tls.secretName"?: string;
  "coder.ingress.tls.wildcardSecretName"?: string;
  "coder.command"?: string;
  "coder.commandArgs"?: string;
  "provisionerDaemon.pskSecretName"?: string;
  extraTemplates?: string;
};
