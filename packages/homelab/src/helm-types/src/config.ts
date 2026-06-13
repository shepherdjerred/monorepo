/**
 * Well-known Kubernetes fields whose shape is defined by the Kubernetes API,
 * not by whatever subset a chart's values.yaml happens to set as defaults.
 *
 * Inferring these from defaults produces types that are too narrow — e.g. a
 * chart defaulting `resources: {requests: {cpu: 0.2}}` would otherwise forbid
 * setting a memory request at all. When a property matches one of these names
 * AND its default value has a compatible shape, the canonical permissive type
 * is emitted instead of a defaults-derived interface.
 */
const K8S_WELL_KNOWN_FIELDS: Record<
  string,
  { type: string; allowedShapes: ("object" | "array")[]; description: string }
> = {
  resources: {
    type: "{ requests?: Record<string, string | number>; limits?: Record<string, string | number> }",
    // RBAC rules also use a key named `resources`, but as an array of strings —
    // the object guard keeps those out.
    allowedShapes: ["object"],
    description:
      "Kubernetes container resources (standard ResourceRequirements: arbitrary resource names, string or numeric quantities)",
  },
  nodeselector: {
    type: "Record<string, string>",
    allowedShapes: ["object"],
    description: "Kubernetes nodeSelector (arbitrary label key/value pairs)",
  },
  tolerations: {
    type: "unknown[]",
    allowedShapes: ["array"],
    description: "Kubernetes tolerations (standard Toleration objects)",
  },
  affinity: {
    type: "Record<string, unknown>",
    allowedShapes: ["object"],
    description: "Kubernetes affinity (standard Affinity object)",
  },
};

/**
 * Return the canonical type for a well-known Kubernetes field, or undefined if
 * the property name doesn't match or the default value's shape is incompatible
 * (e.g. an RBAC `resources: ["secrets"]` array, which must NOT become
 * ResourceRequirements).
 */
export function getWellKnownK8sFieldType(
  propertyName: string,
  value: unknown,
): { type: string; description: string } | undefined {
  const field = K8S_WELL_KNOWN_FIELDS[propertyName.toLowerCase()];
  if (!field) {
    return undefined;
  }
  // A null/undefined default carries no shape signal — trust the name.
  if (value != null) {
    const shape: "object" | "array" | "primitive" = Array.isArray(value)
      ? "array"
      : typeof value === "object"
        ? "object"
        : "primitive";
    if (shape === "primitive" || !field.allowedShapes.includes(shape)) {
      return undefined;
    }
  }
  return { type: field.type, description: field.description };
}

/**
 * Configuration for types that should allow arbitrary additional properties.
 * Maps chart names to array of key paths that should be extensible.
 *
 * These are typically config maps, RBAC policies, or other key-value stores
 * where the schema doesn't enumerate all possible keys.
 */
export const EXTENSIBLE_TYPE_PATTERNS: Record<string, string[]> = {
  "argo-cd": [
    "configs.cm", // Allows accounts.*, and other custom config
    "configs.rbac", // Allows policy.*, custom RBAC rules
  ],
  "kube-prometheus-stack": [
    "grafana", // Allows "grafana.ini" and other quoted config keys
    "grafana.deploymentStrategy", // Allows Kubernetes Deployment strategy objects with flexible fields
    "alertmanager.config.receivers", // Allows various *_configs (pagerduty_configs, etc.) on array elements
    "prometheus-node-exporter", // Allows extraHostVolumeMounts and other node exporter specific configs
    "prometheusNodeExporter", // Also support camelCase variant
  ],
  loki: [
    "loki.limits_config", // Allows retention_period and other limit configs (note: underscore, not camelCase)
    "loki.limitsConfig", // Also support camelCase variant
    "compactor", // Allows various compactor settings
    "minio.persistence", // Storage configs
  ],
  minecraft: [
    "persistence", // Storage class and other persistence options
  ],
  openebs: [
    "zfs-localpv", // ZFS-specific configs
  ],
  "postgres-operator": [
    "configGeneral", // General config allows various settings
  ],
  chartmuseum: [
    "persistence", // Storage options
  ],
  "intel-device-plugins-operator": [
    // Root level for device-specific settings
    "",
  ],
  "prometheus-adapter": [
    "rules", // Allows resource, custom, external and other rule configurations
  ],
  velero: [
    "kubectl.image", // Allows image configuration
  ],
  seaweedfs: [
    "volume.dataDirs", // dataDirs elements support size, storageClass when type is persistentVolumeClaim
  ],
  // OCI charts that document config keys only as commented-out examples in
  // values.yaml, so inference from active defaults misses valid keys.
  "dagger-helm": [
    "engine", // engine.port / engine.configJson / engine.config are commented-out chart examples
  ],
  "agent-stack-k8s": [
    "config", // config.queue / max-in-flight / empty-job-grace-period / default-checkout-params are valid but not defaulted
  ],
};

/**
 * Pattern-based detection for extensible types.
 * Returns true if the property should allow arbitrary keys.
 */
export function shouldAllowArbitraryProps(
  keyPath: string,
  chartName: string,
  propertyName: string,
  yamlComment?: string,
): boolean {
  // Check configured patterns for this chart
  const patterns = EXTENSIBLE_TYPE_PATTERNS[chartName];
  if (patterns) {
    for (const pattern of patterns) {
      if (
        pattern === keyPath ||
        (pattern === "" && keyPath.split(".").length === 1)
      ) {
        return true;
      }
      // Also match if keyPath starts with pattern
      if (pattern && keyPath.startsWith(`${pattern}.`)) {
        return true;
      }
    }
  }

  // Pattern-based detection from property names
  const lowerProp = propertyName.toLowerCase();
  const lowerPath = keyPath.toLowerCase();

  // Common names that suggest extensibility
  const extensibleNames = [
    "cm", // ConfigMap data
    "data",
    "config",
    "configs",
    "settings",
    "parameters",
    "options",
    "extraenv",
    "annotations",
    "labels",
    "nodeaffinity",
    "toleration",
  ];

  if (extensibleNames.includes(lowerProp)) {
    return true;
  }

  // Check for persistence/storage which often has provider-specific fields
  if (lowerPath.includes("persistence") || lowerPath.includes("storage")) {
    return true;
  }

  // Check YAML comments for hints
  if (yamlComment != null && yamlComment !== "") {
    const commentLower = yamlComment.toLowerCase();
    if (
      /\b(?:arbitrary|custom|additional|extra|any)\s+(?:keys?|properties?|fields?|values?)\b/i.test(
        commentLower,
      ) ||
      /\bkey[\s-]?value\s+pairs?\b/i.test(commentLower)
    ) {
      return true;
    }
  }

  return false;
}
