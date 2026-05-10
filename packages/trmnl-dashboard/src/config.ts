import { z } from "zod";

export type ConfiguredEntity = {
  entityId: string;
  label: string;
};

export type AppConfig = {
  port: number;
  trmnlApiKey: string;
  homeAssistant: {
    url: string;
    token: string;
    batteryThreshold: number;
    presence: ConfiguredEntity[];
    security: ConfiguredEntity[];
    climate: ConfiguredEntity[];
  };
  homelab: {
    prometheusUrl: string;
    alertmanagerUrl: string;
    bugsinkUrl: string;
    bugsinkToken?: string;
    pagerDutyToken?: string;
    kubernetesUrl: string;
    kubernetesTokenPath: string;
    kubernetesCaPath: string;
  };
};

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  TRMNL_API_KEY: z.string().min(1),
  HA_URL: z
    .string()
    .pipe(z.url())
    .default("http://homeassistant-service.home:8123"),
  HA_TOKEN: z.string().min(1),
  HA_BATTERY_THRESHOLD: z.coerce.number().min(0).max(100).default(20),
  HA_PRESENCE_ENTITIES: z.string().default(""),
  HA_SECURITY_ENTITIES: z.string().default(""),
  HA_CLIMATE_ENTITIES: z.string().default(""),
  PROMETHEUS_URL: z
    .string()
    .pipe(z.url())
    .default("http://prometheus-kube-prometheus-prometheus.prometheus:9090"),
  ALERTMANAGER_URL: z
    .string()
    .pipe(z.url())
    .default("http://prometheus-kube-prometheus-alertmanager.prometheus:9093"),
  BUGSINK_URL: z
    .string()
    .pipe(z.url())
    .default("http://bugsink-service.bugsink:8000/api/canonical/0"),
  BUGSINK_TOKEN: z.string().optional(),
  PAGERDUTY_TOKEN: z.string().optional(),
  KUBERNETES_SERVICE_HOST: z.string().optional(),
  KUBERNETES_SERVICE_PORT: z.string().optional(),
  KUBERNETES_API_URL: z.string().pipe(z.url()).optional(),
  KUBERNETES_TOKEN_PATH: z
    .string()
    .default("/var/run/secrets/kubernetes.io/serviceaccount/token"),
  KUBERNETES_CA_PATH: z
    .string()
    .default("/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"),
});

export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const parsed = EnvSchema.parse(env);
  const kubernetesUrl =
    parsed.KUBERNETES_API_URL ??
    `https://${parsed.KUBERNETES_SERVICE_HOST ?? "kubernetes.default.svc"}:${
      parsed.KUBERNETES_SERVICE_PORT ?? "443"
    }`;

  return {
    port: parsed.PORT,
    trmnlApiKey: parsed.TRMNL_API_KEY,
    homeAssistant: {
      url: parsed.HA_URL,
      token: parsed.HA_TOKEN,
      batteryThreshold: parsed.HA_BATTERY_THRESHOLD,
      presence: parseEntities(parsed.HA_PRESENCE_ENTITIES),
      security: parseEntities(parsed.HA_SECURITY_ENTITIES),
      climate: parseEntities(parsed.HA_CLIMATE_ENTITIES),
    },
    homelab: {
      prometheusUrl: parsed.PROMETHEUS_URL,
      alertmanagerUrl: parsed.ALERTMANAGER_URL,
      bugsinkUrl: parsed.BUGSINK_URL,
      ...(parsed.BUGSINK_TOKEN == null
        ? {}
        : { bugsinkToken: parsed.BUGSINK_TOKEN }),
      ...(parsed.PAGERDUTY_TOKEN == null
        ? {}
        : { pagerDutyToken: parsed.PAGERDUTY_TOKEN }),
      kubernetesUrl,
      kubernetesTokenPath: parsed.KUBERNETES_TOKEN_PATH,
      kubernetesCaPath: parsed.KUBERNETES_CA_PATH,
    },
  };
}

export function parseEntities(value: string): ConfiguredEntity[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const [entityId, label] = part.split(":", 2);
      if (entityId == null || entityId.trim() === "") {
        throw new Error(`Invalid entity config: ${part}`);
      }
      return {
        entityId: entityId.trim(),
        label:
          label == null || label.trim() === "" ? entityId.trim() : label.trim(),
      };
    });
}
