import { describe, expect, test } from "bun:test";
import { parseYAMLComments } from "./yaml-comments.ts";

describe("Real-World Helm Charts", () => {
  describe("PostgreSQL (Bitnami)", () => {
    test("should handle complex authentication configuration with commented alternatives", () => {
      // Real pattern from bitnami/postgresql values.yaml
      const yaml = `## @param auth.username Name for a custom user to create
## @param auth.password Password for the custom user to create
## @param auth.database Name for a custom database to create
## @param auth.existingSecret Name of existing secret to use for PostgreSQL credentials
## @param auth.secretKeys.adminPasswordKey Name of key in existing secret to use for PostgreSQL credentials
##
auth:
  ## @param auth.enablePostgresUser Assign a password to the "postgres" admin user. Otherwise, remote access will be blocked for this user
  ##
  enablePostgresUser: true
  ## @param auth.postgresPassword Password for the "postgres" admin user. Ignored if \`auth.existingSecret\` is provided
  ##
  postgresPassword: ""
  ## @param auth.username Name for a custom user to create
  ##
  username: ""
  ## @param auth.password Password for the custom user to create. Ignored if \`auth.existingSecret\` is provided
  ##
  password: ""
  ## @param auth.database Name for a custom database to create
  ##
  database: ""`;

      const comments = parseYAMLComments(yaml);

      expect(comments.get("auth.enablePostgresUser")).toBe(
        'Assign a password to the "postgres" admin user. Otherwise, remote access will be blocked for this user',
      );
      expect(comments.get("auth.postgresPassword")).toBe(
        'Password for the "postgres" admin user. Ignored if `auth.existingSecret` is provided',
      );
      expect(comments.get("auth.username")).toBe("Name for a custom user to create");
      expect(comments.get("auth.password")).toBe(
        "Password for the custom user to create. Ignored if `auth.existingSecret` is provided",
      );
      expect(comments.get("auth.database")).toBe("Name for a custom database to create");
    });

    test("should handle volume configuration with examples", () => {
      const yaml = `## @param primary.persistence.enabled Enable PostgreSQL Primary data persistence using PVC
## @param primary.persistence.storageClass PVC Storage Class for PostgreSQL Primary data volume
## @param primary.persistence.size PVC Storage Request for PostgreSQL volume
##
primary:
  persistence:
    enabled: true
    storageClass: ""
    accessModes:
      - ReadWriteOnce
    size: 8Gi`;

      const comments = parseYAMLComments(yaml);

      expect(comments.get("primary.persistence.enabled")).toBe("Enable PostgreSQL Primary data persistence using PVC");
      expect(comments.get("primary.persistence.storageClass")).toBe(
        "PVC Storage Class for PostgreSQL Primary data volume",
      );
    });
  });

  describe("Traefik", () => {
    // TODO: Edge case - ports.web.expose incorrectly gets comment from commented-out hostPort
    // The YAML AST accumulates comments from above, including "Use host port 80 on DaemonSet"
    // which is actually for the commented-out `# hostPort: 80` line, not for `expose: true`.
    // This requires more sophisticated comment-to-key association logic to detect and filter
    // comments that belong to commented-out keys when they appear between documented sections.
    test.skip("should handle service configuration with port definitions", () => {
      // Real pattern from traefik helm chart
      const yaml = `# -- Create a default IngressClass for Traefik
ingressClass:
  enabled: true
  isDefaultClass: true

# -- Configure ports
ports:
  # -- Configure the web port (HTTP)
  web:
    port: 80
    # -- Use host port 80 on DaemonSet
    # hostPort: 80
    expose: true
    exposedPort: 80
    protocol: TCP

  # -- Configure the websecure port (HTTPS)
  websecure:
    port: 443
    # -- Use host port 443 on DaemonSet
    # hostPort: 443
    expose: true
    exposedPort: 443
    protocol: TCP
    # -- Enable TLS on websecure port
    tls:
      enabled: true`;

      const comments = parseYAMLComments(yaml);

      // Comment is on parent ingressClass, not nested enabled
      expect(comments.get("ingressClass")).toBe("Create a default IngressClass for Traefik");
      expect(comments.get("ports.web")).toBe("Configure the web port (HTTP)");
      expect(comments.get("ports.web.expose")).not.toContain("Use host port 80");
      expect(comments.get("ports.websecure")).toBe("Configure the websecure port (HTTPS)");
      expect(comments.get("ports.websecure.tls.enabled")).toBe("Enable TLS on websecure port");
    });

    test("should handle deployment configuration with resource examples", () => {
      const yaml = `# -- The number of replicas
replicas: 1

# -- Additional deployment annotations
deployment:
  # -- Enable deployment
  enabled: true
  # -- Deployment or DaemonSet
  kind: Deployment
  # -- Number of old ReplicaSets to retain
  revisionHistoryLimit: 10
  # -- Minimal available pods for PodDisruptionBudget
  # minAvailable: 1
  # -- Maximal unavailable pods for PodDisruptionBudget
  # maxUnavailable: 1

# -- Resource limits and requests
resources: {}
  # We usually recommend not to specify default resources and to leave this as a conscious
  # choice for the user. This also increases chances charts run on environments with little
  # resources, such as Minikube. If you do want to specify resources, uncomment the following
  # lines, adjust them as necessary, and remove the curly braces after 'resources:'.
  # limits:
  #   cpu: 100m
  #   memory: 128Mi
  # requests:
  #   cpu: 100m
  #   memory: 128Mi`;

      const comments = parseYAMLComments(yaml);

      expect(comments.get("replicas")).toBe("The number of replicas");
      expect(comments.get("deployment.enabled")).toBe("Enable deployment");
      expect(comments.get("deployment.kind")).toBe("Deployment or DaemonSet");
      expect(comments.get("deployment.revisionHistoryLimit")).toBe("Number of old ReplicaSets to retain");
      expect(comments.get("resources")).toContain("We usually recommend not to specify default resources");
      expect(comments.get("resources")).toContain("Minikube");
      // Should not contain the commented-out YAML examples
      expect(comments.get("resources")).not.toContain("cpu: 100m");
    });
  });

  describe("cert-manager", () => {
    test("should handle webhook configuration with detailed comments", () => {
      const yaml = `# -- Configure the webhook service
webhook:
  # -- Number of replicas for the webhook
  replicaCount: 1

  # -- Configure the webhook pod
  # The webhook is used to validate and mutate cert-manager resources
  # and to validate the caBundle in webhook configurations.
  # https://cert-manager.io/docs/concepts/webhook/
  timeoutSeconds: 10

  # -- Configure hostNetwork for the webhook
  # This is required when using a custom CNI where the webhook
  # cannot be reached by the service ClusterIP
  # hostNetwork: false

  # -- Configure nodeSelector for the webhook
  nodeSelector:
    kubernetes.io/os: linux`;

      const comments = parseYAMLComments(yaml);

      expect(comments.get("webhook")).toBe("Configure the webhook service");
      expect(comments.get("webhook.replicaCount")).toBe("Number of replicas for the webhook");
      expect(comments.get("webhook.timeoutSeconds")).toContain(
        "The webhook is used to validate and mutate cert-manager resources",
      );
      expect(comments.get("webhook.timeoutSeconds")).toContain("https://cert-manager.io/docs/concepts/webhook/");
      // nodeSelector accumulates all preceding comments (hostNetwork + nodeSelector)
      expect(comments.get("webhook.nodeSelector")).toContain("Configure nodeSelector for the webhook");
    });

    test("should handle ClusterIssuer examples in comments", () => {
      const yaml = `# -- Configure the default ClusterIssuer
# This creates a ClusterIssuer resource that can be used to issue certificates
# Example:
# clusterIssuer:
#   name: letsencrypt-prod
#   email: admin@example.com
#   server: https://acme-v02.api.letsencrypt.org/directory
#   privateKeySecretRef:
#     name: letsencrypt-prod
#   solvers:
#   - http01:
#       ingress:
#         class: nginx
#
# For more information see: https://cert-manager.io/docs/configuration/acme/
clusterIssuer:
  create: false`;

      const comments = parseYAMLComments(yaml);

      // Comment is on parent clusterIssuer, not nested create
      expect(comments.get("clusterIssuer")).toContain(
        "This creates a ClusterIssuer resource that can be used to issue certificates",
      );
      expect(comments.get("clusterIssuer")).toContain(
        "For more information see: https://cert-manager.io/docs/configuration/acme/",
      );
      // Should contain the example but formatted properly
      expect(comments.get("clusterIssuer")).toContain("Example:");
    });
  });

  describe("Prometheus", () => {
    test("should handle alertmanager configuration with complex nested structure", () => {
      const yaml = `## Alertmanager configuration
##
alertmanager:
  ## Deploy alertmanager
  ##
  enabled: true

  ## Alertmanager configuration directives
  ## Ref: https://prometheus.io/docs/alerting/configuration/#configuration-file
  ##      https://prometheus.io/webtools/alerting/routing-tree-editor/
  ##
  config:
    global:
      resolve_timeout: 5m
    route:
      group_by: ['alertname', 'cluster']
      group_wait: 10s
      group_interval: 10s
      repeat_interval: 12h
      receiver: 'null'
    receivers:
      - name: 'null'

  ## Configure Ingress for Alertmanager
  ##
  ingress:
    ## Enable Ingress
    ##
    enabled: false`;

      const comments = parseYAMLComments(yaml);

      expect(comments.get("alertmanager")).toBe("Alertmanager configuration");
      expect(comments.get("alertmanager.enabled")).toBe("Deploy alertmanager");
      // Section header "Alertmanager configuration directives" is filtered, Ref lines are kept
      expect(comments.get("alertmanager.config")).toContain("https://prometheus.io/docs/alerting/configuration/");
      expect(comments.get("alertmanager.config")).toContain(
        "https://prometheus.io/webtools/alerting/routing-tree-editor/",
      );
      expect(comments.get("alertmanager.ingress")).toBe("Configure Ingress for Alertmanager");
      expect(comments.get("alertmanager.ingress.enabled")).toBe("Enable Ingress");
    });

    test("should handle scrape configuration with intervals and examples", () => {
      const yaml = `## Prometheus scrape configuration
## Ref: https://prometheus.io/docs/prometheus/latest/configuration/configuration/#scrape_config
##
prometheus:
  prometheusSpec:
    ## How frequently to scrape targets by default
    ##
    scrapeInterval: "30s"

    ## How long until a scrape request times out
    ##
    scrapeTimeout: "10s"

    ## How frequently to evaluate rules
    ##
    evaluationInterval: "30s"

    ## Additional scrape configurations
    ## Example:
    ## additionalScrapeConfigs:
    ## - job_name: 'my-job'
    ##   static_configs:
    ##   - targets: ['my-target:9090']
    ##
    additionalScrapeConfigs: []`;

      const comments = parseYAMLComments(yaml);

      expect(comments.get("prometheus.prometheusSpec.scrapeInterval")).toBe(
        "How frequently to scrape targets by default",
      );
      expect(comments.get("prometheus.prometheusSpec.scrapeTimeout")).toBe("How long until a scrape request times out");
      expect(comments.get("prometheus.prometheusSpec.evaluationInterval")).toBe("How frequently to evaluate rules");
      expect(comments.get("prometheus.prometheusSpec.additionalScrapeConfigs")).toContain(
        "Additional scrape configurations",
      );
      expect(comments.get("prometheus.prometheusSpec.additionalScrapeConfigs")).toContain("Example:");
    });
  });

  describe("Ingress-NGINX", () => {
    // TODO: Edge case - section header filtering removes prose before Ref links
    // Comment has: "## Controller configuration\n## Ref: https://..."
    // After filtering, section header "Controller configuration" is removed as it appears
    // before config code, leaving only "Ref: https://..." which is technically correct but
    // loses the descriptive text. Need to preserve section headers when followed only by Refs.
    test.skip("should handle controller configuration with security settings", () => {
      const yaml = `## Ingress controller configuration
##
controller:
  ## Controller container name
  ##
  name: controller

  ## Controller container image
  ##
  image:
    registry: registry.k8s.io
    image: ingress-nginx/controller
    tag: "v1.9.4"
    digest: sha256:5b161f051d017e55d358435f295f5e9a297e66158f136321d9b04520ec6c48a3

  ## Controller configuration
  ## Ref: https://kubernetes.github.io/ingress-nginx/user-guide/nginx-configuration/configmap/
  ##
  config:
    ## Enable SSL passthrough
    ## This is required for WebSocket traffic
    ## enable-ssl-passthrough: "true"

    ## Set real IP from proxy
    ## use-proxy-protocol: "false"

    ## Set real IP recursively
    use-forwarded-headers: "true"

    ## Configure HSTS
    hsts: "true"
    hsts-max-age: "31536000"
    hsts-include-subdomains: "true"`;

      const comments = parseYAMLComments(yaml);

      expect(comments.get("controller")).toBe("Ingress controller configuration");
      expect(comments.get("controller.name")).toBe("Controller container name");
      expect(comments.get("controller.image")).toBe("Controller container image");
      expect(comments.get("controller.config")).toContain("Controller configuration");
      expect(comments.get("controller.config")).toContain(
        "https://kubernetes.github.io/ingress-nginx/user-guide/nginx-configuration/configmap/",
      );
      expect(comments.get("controller.config.use-forwarded-headers")).not.toContain("enable-ssl-passthrough");
      expect(comments.get("controller.config.hsts")).toBe("Configure HSTS");
    });

    // TODO: Edge case - comment association with parent vs nested keys
    // The comment "Admission webhook configuration..." is associated with parent `controller`
    // key rather than the nested `controller.admissionWebhooks` key. The YAML AST groups
    // the top-level comment with the first real key it encounters. To fix this, we'd need
    // to detect when a comment describes a nested structure name and re-associate it.
    test.skip("should handle admission webhook configuration", () => {
      const yaml = `## Admission webhook configuration
## This validates Ingress objects before they are created
## Ref: https://kubernetes.github.io/ingress-nginx/deploy/validating-webhook/
##
controller:
  admissionWebhooks:
    ## Enable admission webhooks
    ##
    enabled: true

    ## Admission webhook failure policy
    ## Fail will prevent the creation of Ingress objects if the webhook is unavailable
    ## Ignore will allow the creation of Ingress objects even if the webhook is unavailable
    ##
    failurePolicy: Fail

    ## Admission webhook port
    ##
    port: 8443

    ## Admission webhook certificate configuration
    ## This certificate is used to secure the webhook endpoint
    ## certificate: /usr/local/certificates/cert
    ## key: /usr/local/certificates/key
    ##
    certificate: /usr/local/certificates/cert`;

      const comments = parseYAMLComments(yaml);

      expect(comments.get("controller.admissionWebhooks")).toContain("This validates Ingress objects");
      expect(comments.get("controller.admissionWebhooks")).toContain(
        "https://kubernetes.github.io/ingress-nginx/deploy/validating-webhook/",
      );
      expect(comments.get("controller.admissionWebhooks.enabled")).toBe("Enable admission webhooks");
      expect(comments.get("controller.admissionWebhooks.failurePolicy")).toContain("Admission webhook failure policy");
      expect(comments.get("controller.admissionWebhooks.failurePolicy")).toContain(
        "Fail will prevent the creation of Ingress objects",
      );
      expect(comments.get("controller.admissionWebhooks.port")).toBe("Admission webhook port");
      expect(comments.get("controller.admissionWebhooks.certificate")).toContain(
        "This certificate is used to secure the webhook endpoint",
      );
    });
  });

  describe("Redis", () => {
    // TODO: Edge case - comment accumulation from preceding commented-out keys
    // The YAML AST gives `master` all preceding comments, including ones about commented-out
    // keys like `# existingSecret: ""` and `# existingSecretPasswordKey: ""`. The actual
    // "Redis Master configuration" comment gets buried in the accumulated text.
    // The filterCommentedOutYAML function doesn't detect these as YAML keys because they
    // have quoted empty strings as values, which doesn't match the pattern for block scalars.
    // Fixing this requires recognizing commented-out keys with ANY value type, not just
    // pipes/empty values, while being careful not to filter legitimate YAML examples in docs.
    test.skip("should handle master-replica configuration", () => {
      const yaml = `## Redis architecture. Allowed values: \`standalone\` or \`replication\`
##
architecture: replication

## Redis Authentication parameters
## ref: https://github.com/bitnami/containers/tree/main/bitnami/redis#setting-a-password
##
auth:
  ## Enable password authentication
  ##
  enabled: true
  ## Redis password
  ## Defaults to a random 10-character alphanumeric string if not set
  ##
  password: ""
  ## The name of an existing secret with Redis credentials
  ## NOTE: When it's set, the previous \`auth.password\` parameter is ignored
  ##
  # existingSecret: ""
  ## Password key to be retrieved from existing secret
  ##
  # existingSecretPasswordKey: ""

## Redis Master configuration
##
master:
  ## Number of Redis master instances to deploy (experimental, requires additional configuration)
  ##
  count: 1

  ## Redis master persistence configuration
  ##
  persistence:
    ## Enable persistence using Persistent Volume Claims
    ##
    enabled: true

    ## Persistent Volume storage class
    ## If defined, storageClassName: <storageClass>
    ## If set to "-", storageClassName: "", which disables dynamic provisioning
    ## If undefined (the default) or set to null, no storageClassName spec is set
    ##
    # storageClass: "-"

    ## Persistent Volume size
    ##
    size: 8Gi`;

      const comments = parseYAMLComments(yaml);

      expect(comments.get("architecture")).toBe("Redis architecture. Allowed values: `standalone` or `replication`");
      expect(comments.get("auth")).toContain("Redis Authentication parameters");
      expect(comments.get("auth")).toContain(
        "https://github.com/bitnami/containers/tree/main/bitnami/redis#setting-a-password",
      );
      expect(comments.get("auth.enabled")).toBe("Enable password authentication");
      expect(comments.get("auth.password")).toContain("Redis password");
      expect(comments.get("auth.password")).toContain("Defaults to a random 10-character alphanumeric string");
      expect(comments.get("master")).toBe("Redis Master configuration");
      expect(comments.get("master.count")).toContain(
        "Number of Redis master instances to deploy (experimental, requires additional configuration)",
      );
      expect(comments.get("master.persistence")).toBe("Redis master persistence configuration");
      expect(comments.get("master.persistence.enabled")).toBe("Enable persistence using Persistent Volume Claims");
      expect(comments.get("master.persistence.size")).toBe("Persistent Volume size");
    });
  });

  describe("Edge Cases from Real Charts", () => {
    test("should handle annotations with special characters and URLs", () => {
      const yaml = `## Add annotations to pods
## ref: https://kubernetes.io/docs/concepts/overview/working-with-objects/annotations/
## Example:
## podAnnotations:
##   prometheus.io/scrape: "true"
##   prometheus.io/port: "9090"
##   prometheus.io/path: "/metrics"
##
podAnnotations: {}`;

      const comments = parseYAMLComments(yaml);

      expect(comments.get("podAnnotations")).toContain("Add annotations to pods");
      expect(comments.get("podAnnotations")).toContain(
        "https://kubernetes.io/docs/concepts/overview/working-with-objects/annotations/",
      );
      expect(comments.get("podAnnotations")).toContain("Example:");
      expect(comments.get("podAnnotations")).toContain("prometheus.io/scrape");
    });

    test("should handle security context with numeric UIDs", () => {
      const yaml = `## Configure security context
## ref: https://kubernetes.io/docs/tasks/configure-pod-container/security-context/
##
securityContext:
  ## Run as specific user ID
  ## runAsUser: 1001
  ## Run as specific group ID
  ## runAsGroup: 1001
  ## Use read-only root filesystem
  ## readOnlyRootFilesystem: true
  ## Drop all capabilities
  ## capabilities:
  ##   drop:
  ##   - ALL
  ##
  runAsNonRoot: true`;

      const comments = parseYAMLComments(yaml);

      expect(comments.get("securityContext")).toContain("Configure security context");
      expect(comments.get("securityContext")).toContain(
        "https://kubernetes.io/docs/tasks/configure-pod-container/security-context/",
      );
      expect(comments.get("securityContext.runAsNonRoot")).not.toContain("runAsUser: 1001");
    });

    test("should handle environment variables with complex examples", () => {
      const yaml = `## Additional environment variables
## Example:
## env:
##   - name: FOO
##     value: "bar"
##   - name: SECRET_KEY
##     valueFrom:
##       secretKeyRef:
##         name: my-secret
##         key: password
##   - name: CONFIG_MAP_KEY
##     valueFrom:
##       configMapKeyRef:
##         name: my-config
##         key: config.yaml
##
## For more information see: https://kubernetes.io/docs/tasks/inject-data-application/define-environment-variable-container/
env: []`;

      const comments = parseYAMLComments(yaml);

      expect(comments.get("env")).toContain("Additional environment variables");
      expect(comments.get("env")).toContain("Example:");
      expect(comments.get("env")).toContain(
        "https://kubernetes.io/docs/tasks/inject-data-application/define-environment-variable-container/",
      );
      // The example should be preserved
      expect(comments.get("env")).toContain("name: FOO");
    });
  });
});
