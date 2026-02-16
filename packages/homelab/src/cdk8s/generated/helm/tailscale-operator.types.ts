// Generated TypeScript types for tailscale-operator Helm chart

export type TailscaleoperatorHelmValuesOauth = {
  /**
   * The Client ID the operator will authenticate with.
   *
   * @default ""
   */
  clientId?: string;
  /**
   * If set a Kubernetes Secret with the provided value will be created in
   * the operator namespace, and mounted into the operator Pod. Takes precedence
   * over oauth.audience.
   *
   * @default ""
   */
  clientSecret?: string;
  /**
   * The audience for oauth.clientId if using a workload identity federation
   * OAuth client. Mutually exclusive with oauth.clientSecret.
   * See https://tailscale.com/kb/1581/workload-identity-federation.
   *
   * @default ""
   */
  audience?: string;
};

export type TailscaleoperatorHelmValuesOauthSecretVolume = object;

export type TailscaleoperatorHelmValuesOperatorConfig = {
  defaultTags?: string[];
  /**
   * @default {...} (4 keys)
   */
  image?: TailscaleoperatorHelmValuesOperatorConfigImage;
  /**
   * info, debug, dev
   *
   * @default "info"
   */
  logging?: string;
  /**
   * @default "tailscale-operator"
   */
  hostname?: string;
  /**
   * @default {"kubernetes.io/os":"linux"}
   */
  nodeSelector?: TailscaleoperatorHelmValuesOperatorConfigNodeSelector;
  /**
   * @default {}
   */
  resources?: TailscaleoperatorHelmValuesOperatorConfigResources;
  /**
   * @default {}
   */
  podAnnotations?: TailscaleoperatorHelmValuesOperatorConfigPodAnnotations;
  /**
   * @default {}
   */
  podLabels?: TailscaleoperatorHelmValuesOperatorConfigPodLabels;
  /**
   * @default {}
   */
  serviceAccountAnnotations?: TailscaleoperatorHelmValuesOperatorConfigServiceAccountAnnotations;
  tolerations?: unknown[];
  /**
   * @default {}
   */
  affinity?: TailscaleoperatorHelmValuesOperatorConfigAffinity;
  /**
   * @default {}
   */
  podSecurityContext?: TailscaleoperatorHelmValuesOperatorConfigPodSecurityContext;
  /**
   * @default {}
   */
  securityContext?: TailscaleoperatorHelmValuesOperatorConfigSecurityContext;
  extraEnv?: unknown[];
};

export type TailscaleoperatorHelmValuesOperatorConfigImage = {
  /**
   * Repository defaults to DockerHub, but images are also synced to ghcr.io/tailscale/k8s-operator.
   *
   * @default "tailscale/k8s-operator"
   */
  repository?: string;
  /**
   * Digest will be prioritized over tag. If neither are set appVersion will be
   * used.
   *
   * @default ""
   */
  tag?: string;
  /**
   * @default ""
   */
  digest?: string;
  /**
   * @default "Always"
   */
  pullPolicy?: string;
};

export type TailscaleoperatorHelmValuesOperatorConfigNodeSelector = {
  /**
   * @default "linux"
   */
  "kubernetes.io/os"?: string;
};

export type TailscaleoperatorHelmValuesOperatorConfigResources = object;

export type TailscaleoperatorHelmValuesOperatorConfigPodAnnotations = object;

export type TailscaleoperatorHelmValuesOperatorConfigPodLabels = object;

export type TailscaleoperatorHelmValuesOperatorConfigServiceAccountAnnotations = object;

export type TailscaleoperatorHelmValuesOperatorConfigAffinity = object;

export type TailscaleoperatorHelmValuesOperatorConfigPodSecurityContext = object;

export type TailscaleoperatorHelmValuesOperatorConfigSecurityContext = object;

export type TailscaleoperatorHelmValuesIngressClass = {
  /**
   * Allows for customization of the ingress class name used by the operator to identify ingresses to reconcile. This does
   * not allow multiple operator instances to manage different ingresses, but provides an onboarding route for users that
   * may have previously set up ingress classes named "tailscale" prior to using the operator.
   *
   * @default "tailscale"
   */
  name?: string;
  /**
   * @default true
   */
  enabled?: boolean;
};

export type TailscaleoperatorHelmValuesProxyConfig = {
  /**
   * Configure the proxy image to use instead of the default tailscale/tailscale:latest.
   * Applying a ProxyClass with `spec.statefulSet.pod.tailscaleContainer.image`
   * set will override any defaults here.
   * Note that ProxyGroups of type "kube-apiserver" use a different default image,
   * tailscale/k8s-proxy:latest, and it is currently only possible to override
   * that image via the same ProxyClass field.
   *
   * @default {"repository":"tailscale/tailscale","tag":"","digest":""}
   */
  image?: TailscaleoperatorHelmValuesProxyConfigImage;
  /**
   * ACL tag that operator will tag proxies with. Operator must be made owner of
   * these tags
   * https://tailscale.com/kb/1236/kubernetes-operator/?q=operator#setting-up-the-kubernetes-operator
   * Multiple tags can be passed as a comma-separated string i.e 'tag:k8s-proxies,tag:prod'.
   * Note that if you pass multiple tags to this field via `--set` flag to helm upgrade/install commands you must escape the comma (for example, "tag:k8s-proxies\,tag:prod"). See https://github.com/helm/helm/issues/1556
   *
   * @default "tag:k8s"
   */
  defaultTags?: string;
  /**
   * @default "auto"
   */
  firewallMode?: string;
  /**
   * If defined, this proxy class will be used as the default proxy class for
   * service and ingress resources that do not have a proxy class defined. It
   * does not apply to Connector resources.
   *
   * @default ""
   */
  defaultProxyClass?: string;
};

export type TailscaleoperatorHelmValuesProxyConfigImage = {
  /**
   * Repository defaults to DockerHub, but images are also synced to ghcr.io/tailscale/tailscale.
   *
   * @default "tailscale/tailscale"
   */
  repository?: string;
  /**
   * Digest will be prioritized over tag. If neither are set appVersion will be
   * used.
   *
   * @default ""
   */
  tag?: string;
  /**
   * @default ""
   */
  digest?: string;
};

export type TailscaleoperatorHelmValuesApiServerProxyConfig = {
  /**
   * "true", "false"
   *
   * @default "false"
   */
  allowImpersonation?: boolean;
  /**
   * If true or noauth, the operator will run an in-process API server proxy.
   * You can deploy a ProxyGroup of type "kube-apiserver" to run a high
   * availability set of API server proxies instead.
   * "true", "false", "noauth"
   *
   * @default "false"
   */
  mode?: boolean;
};

export type TailscaleoperatorHelmValues = {
  /**
   * Copyright (c) Tailscale Inc & AUTHORS
   * Operator oauth credentials. If unset a Secret named operator-oauth must be
   * precreated or oauthSecretVolume needs to be adjusted. This block will be
   * overridden by oauthSecretVolume, if set.
   *
   * @default {"clientId":"","clientSecret":"","audience":""}
   */
  oauth?: TailscaleoperatorHelmValuesOauth;
  /**
   * URL of the control plane to be used by all resources managed by the operator.
   *
   * @default ""
   */
  loginServer?: string;
  /**
   * Secret volume.
   * If set it defines the volume the oauth secrets will be mounted from.
   * The volume needs to contain two files named `client_id` and `client_secret`.
   * If unset the volume will reference the Secret named operator-oauth.
   * This block will override the oauth block.
   *
   * @default {}
   */
  oauthSecretVolume?: TailscaleoperatorHelmValuesOauthSecretVolume;
  /**
   * NAME is pre-defined!
   * installCRDs determines whether tailscale.com CRDs should be installed as part
   * of chart installation. We do not use Helm's CRD installation mechanism as that
   * does not allow for upgrading CRDs.
   * https://helm.sh/docs/chart_best_practices/custom_resource_definitions/
   *
   * @default true
   */
  installCRDs?: boolean;
  /**
   * In the case that you already have a tailscale ingressclass in your cluster (or vcluster), you can disable the creation here
   *
   * @default {...} (14 keys)
   */
  operatorConfig?: TailscaleoperatorHelmValuesOperatorConfig;
  /**
   * @default {"name":"tailscale","enabled":true}
   */
  ingressClass?: TailscaleoperatorHelmValuesIngressClass;
  /**
   * proxyConfig contains configuraton that will be applied to any ingress/egress
   * proxies created by the operator.
   * https://tailscale.com/kb/1439/kubernetes-operator-cluster-ingress
   * https://tailscale.com/kb/1438/kubernetes-operator-cluster-egress
   * Note that this section contains only a few global configuration options and
   * will not be updated with more configuration options in the future.
   * If you need more configuration options, take a look at ProxyClass:
   * https://tailscale.com/kb/1445/kubernetes-operator-customization#cluster-resource-customization-using-proxyclass-custom-resource
   *
   * @default {...} (4 keys)
   */
  proxyConfig?: TailscaleoperatorHelmValuesProxyConfig;
  /**
   * apiServerProxyConfig allows to configure whether the operator should expose
   * Kubernetes API server.
   * https://tailscale.com/kb/1437/kubernetes-operator-api-server-proxy
   *
   * @default {"allowImpersonation":"false","mode":"false"}
   */
  apiServerProxyConfig?: TailscaleoperatorHelmValuesApiServerProxyConfig;
  imagePullSecrets?: unknown[];
};

export type TailscaleoperatorHelmParameters = {
  "oauth.clientId"?: string;
  "oauth.clientSecret"?: string;
  "oauth.audience"?: string;
  loginServer?: string;
  installCRDs?: string;
  "operatorConfig.defaultTags"?: string;
  "operatorConfig.image.repository"?: string;
  "operatorConfig.image.tag"?: string;
  "operatorConfig.image.digest"?: string;
  "operatorConfig.image.pullPolicy"?: string;
  "operatorConfig.logging"?: string;
  "operatorConfig.hostname"?: string;
  "operatorConfig.nodeSelector.kubernetes.io/os"?: string;
  "operatorConfig.tolerations"?: string;
  "operatorConfig.extraEnv"?: string;
  "ingressClass.name"?: string;
  "ingressClass.enabled"?: string;
  "proxyConfig.image.repository"?: string;
  "proxyConfig.image.tag"?: string;
  "proxyConfig.image.digest"?: string;
  "proxyConfig.defaultTags"?: string;
  "proxyConfig.firewallMode"?: string;
  "proxyConfig.defaultProxyClass"?: string;
  "apiServerProxyConfig.allowImpersonation"?: string;
  "apiServerProxyConfig.mode"?: string;
  imagePullSecrets?: string;
};
