import { z } from "zod";

export type ConfiguredEntity = {
  entityId: string;
  label: string;
};

export type AppConfig = {
  port: number;
  trmnlApiKey: string;
  displayTimeZone: string;
  homeAssistant: {
    url: string;
    token: string;
    batteryThreshold: number;
    unavailableIgnoredDomains: string[];
    unavailableIgnoredEntityGlobs: readonly string[];
    presence: ConfiguredEntity[];
    security: ConfiguredEntity[];
    climate: ConfiguredEntity[];
  };
  homelab: {
    prometheusUrl: string;
    alertDashboardUrl: string;
    bugsinkUrl: string;
    bugsinkToken?: string;
    kubernetesUrl: string;
    kubernetesTokenPath: string;
    kubernetesCaPath: string;
  };
};

const EnvSchema = z.object({
  // Port zero asks the operating system to atomically allocate an ephemeral
  // listener. Production keeps its explicit positive port, while the image
  // smoke can avoid racing concurrent BuildKit stages for a fixed port.
  PORT: z.coerce.number().int().nonnegative().default(3000),
  TRMNL_API_KEY: z.string().min(1),
  DISPLAY_TIME_ZONE: z.string().min(1).default("America/Los_Angeles"),
  HA_URL: z
    .string()
    .pipe(z.url())
    .default("http://homeassistant-service.home:8123"),
  HA_TOKEN: z.string().min(1),
  HA_BATTERY_THRESHOLD: z.coerce.number().min(0).max(100).default(20),
  HA_UNAVAILABLE_IGNORED_DOMAINS: z
    .string()
    .default(
      "group,automation,scene,script,button,event,number,select,text,update,conversation,stt,tts",
    ),
  HA_PRESENCE_ENTITIES: z.string().default(""),
  HA_SECURITY_ENTITIES: z.string().default(""),
  HA_CLIMATE_ENTITIES: z.string().default(""),
  PROMETHEUS_URL: z
    .string()
    .pipe(z.url())
    .default("http://prometheus-kube-prometheus-prometheus.prometheus:9090"),
  ALERT_DASHBOARD_URL: z
    .string()
    .pipe(z.url())
    .default(
      "http://alert-dashboard-alert-dashboard-service.alert-dashboard:7341",
    ),
  BUGSINK_URL: z
    .string()
    .pipe(z.url())
    .default("http://bugsink-bugsink-service.bugsink:8000/api/canonical/0"),
  BUGSINK_TOKEN: z.string().optional(),
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

// Portable speakers, TVs, and companion diagnostics are often unavailable
// by design. This is product policy in source, not an environment override.
export const UNAVAILABLE_IGNORED_ENTITY_GLOBS = [
  "sensor.ipad_*",
  "binary_sensor.ipad_*",
  "sensor.shuxin_*",
  "binary_sensor.shuxin_*",
  "sensor.iphone_*",
  "binary_sensor.iphone_*",
  "sensor.jerred_iphone_*",
  "media_player.rooftop",
  "sensor.rooftop_*",
  "switch.rooftop_*",
  "switch.play_*",
  "binary_sensor.rooftop_*",
  "media_player.living_room_television",
  "sensor.living_room_television_*",
  "binary_sensor.*_ac_mains_*",
] as const;

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
    displayTimeZone: parsed.DISPLAY_TIME_ZONE,
    homeAssistant: {
      url: parsed.HA_URL,
      token: parsed.HA_TOKEN,
      batteryThreshold: parsed.HA_BATTERY_THRESHOLD,
      unavailableIgnoredDomains: parseCsv(
        parsed.HA_UNAVAILABLE_IGNORED_DOMAINS,
      ),
      unavailableIgnoredEntityGlobs: UNAVAILABLE_IGNORED_ENTITY_GLOBS,
      presence: parseEntities(parsed.HA_PRESENCE_ENTITIES),
      security: parseEntities(parsed.HA_SECURITY_ENTITIES),
      climate: parseEntities(parsed.HA_CLIMATE_ENTITIES),
    },
    homelab: {
      prometheusUrl: parsed.PROMETHEUS_URL,
      alertDashboardUrl: parsed.ALERT_DASHBOARD_URL,
      bugsinkUrl: parsed.BUGSINK_URL,
      ...(parsed.BUGSINK_TOKEN == null
        ? {}
        : { bugsinkToken: parsed.BUGSINK_TOKEN }),
      kubernetesUrl,
      kubernetesTokenPath: parsed.KUBERNETES_TOKEN_PATH,
      kubernetesCaPath: parsed.KUBERNETES_CA_PATH,
    },
  };
}

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function entityIdMatchesGlob(entityId: string, glob: string): boolean {
  const escaped = glob
    .replaceAll(/[.+^${}()|[\]\\]/g, String.raw`\$&`)
    .replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`).test(entityId);
}

export function isExpectedUnavailable(
  entityId: string,
  ignoredDomains: readonly string[],
  ignoredGlobs: readonly string[],
): boolean {
  const domain = entityId.split(".", 1)[0] ?? "";
  return (
    ignoredDomains.includes(domain) ||
    ignoredGlobs.some((glob) => entityIdMatchesGlob(entityId, glob))
  );
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
