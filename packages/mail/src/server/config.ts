import { z } from "zod";
import {
  initFeatureFlags,
  isEnabled,
  shutdownFeatureFlags,
  stringValue,
  type InitFeatureFlagsOptions,
} from "@shepherdjerred/feature-flags";
import {
  FeatureFlagModeSchema,
  type FeatureFlagMode,
} from "@shepherdjerred/feature-flags/config/schema.ts";
import { flagValueSchema } from "@shepherdjerred/feature-flags/flag-value-schemas.ts";
import type { FlagMetricsRecorder } from "@shepherdjerred/feature-flags/observability.ts";
import { MailClientsMapSchema, type MailClientsMap } from "./auth.ts";

export type EnvMap = Readonly<Record<string, string | undefined>>;

const PORT_STRING_PATTERN = /^(?:0|[1-9]\d*)$/u;

const OptionalNonEmptyStringSchema = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim().length === 0 ? undefined : value,
  z.string().trim().min(1).optional(),
);

const OptionalPortSchema = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim().length === 0 ? undefined : value,
  z
    .union([
      z.number().int().min(0).max(65_535),
      z
        .string()
        .trim()
        .regex(PORT_STRING_PATTERN, "Port must be a non-negative integer")
        .transform(Number)
        .pipe(z.number().int().min(0).max(65_535)),
    ])
    .optional(),
);

const BooleanEnvStringSchema = z
  .enum(["true", "false", "1", "0"])
  .transform((val) => val === "true" || val === "1");

const MailEnvSchema = z.object({
  HOST: OptionalNonEmptyStringSchema,
  PORT: OptionalPortSchema,
  MAIL_API_PORT: OptionalPortSchema,
  MAIL_SMTP_PORT: OptionalPortSchema,
  MAIL_DATABASE_PATH: OptionalNonEmptyStringSchema,
  MAIL_CLIENTS_JSON: z.string().optional(),
  FASTMAIL_SMTP_HOST: OptionalNonEmptyStringSchema,
  FASTMAIL_SMTP_PORT: OptionalPortSchema,
  FASTMAIL_SMTP_USERNAME: OptionalNonEmptyStringSchema,
  FASTMAIL_SMTP_PASSWORD: z.preprocess(
    (value) =>
      typeof value === "string" && value.length === 0 ? undefined : value,
    z.string().min(1).optional(),
  ),
  FASTMAIL_SMTP_REQUIRE_TLS: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim().length === 0
        ? undefined
        : typeof value === "string"
          ? value.trim().toLowerCase()
          : value,
    BooleanEnvStringSchema.optional(),
  ),
  MAIL_SMTP_TLS_CERT_PATH: OptionalNonEmptyStringSchema,
  MAIL_SMTP_TLS_KEY_PATH: OptionalNonEmptyStringSchema,
  MAIL_SMTP_HOSTNAME: OptionalNonEmptyStringSchema,
  MAIL_RELAY_ENABLED_FALLBACK: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim().length === 0
        ? undefined
        : typeof value === "string"
          ? value.trim().toLowerCase()
          : value,
    z.enum(["true", "false"]).optional(),
  ),
  FEATURE_FLAGS_MODE: OptionalNonEmptyStringSchema,
});

const MailSettingsSchema = flagValueSchema("mail-settings");
export type MailSettings = z.output<typeof MailSettingsSchema>;

export const DEFAULT_MAIL_SETTINGS: MailSettings = {
  retentionDays: 30,
  maxPerClientPerTenMinutes: 200,
  allowCleartextSmtpAuth: false,
};

const DEFAULT_MAIL_SETTINGS_JSON = JSON.stringify(DEFAULT_MAIL_SETTINGS);

export type MailServerConfig = {
  readonly host: string;
  readonly port: number;
  readonly apiPort: number | undefined;
  readonly smtpPort: number | undefined;
  readonly databasePath: string;
  readonly clients: MailClientsMap;
  readonly fastmailHost: string;
  readonly fastmailPort: number;
  readonly fastmailUsername: string | undefined;
  readonly fastmailPassword: string | undefined;
  readonly fastmailRequireTls: boolean;
  readonly smtpTlsCertPath: string | undefined;
  readonly smtpTlsKeyPath: string | undefined;
  readonly smtpHostname: string;
  readonly relayEnabledFallback: boolean;
  readonly featureFlagsMode: FeatureFlagMode | undefined;
};

function parseClientsJson(raw: string | undefined): MailClientsMap {
  if (raw === undefined || raw.trim().length === 0) {
    return {};
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`MAIL_CLIENTS_JSON is not valid JSON: ${detail}`, {
      cause: error,
    });
  }
  return MailClientsMapSchema.parse(parsedJson);
}

export function loadMailConfig(env: EnvMap = Bun.env): MailServerConfig {
  const parsed = MailEnvSchema.parse(env);
  const clients = parseClientsJson(parsed.MAIL_CLIENTS_JSON);
  const featureFlagsMode =
    parsed.FEATURE_FLAGS_MODE === undefined
      ? undefined
      : FeatureFlagModeSchema.parse(parsed.FEATURE_FLAGS_MODE);

  const hasCert = parsed.MAIL_SMTP_TLS_CERT_PATH !== undefined;
  const hasKey = parsed.MAIL_SMTP_TLS_KEY_PATH !== undefined;
  if (hasCert !== hasKey) {
    throw new Error(
      "MAIL_SMTP_TLS_CERT_PATH and MAIL_SMTP_TLS_KEY_PATH must both be set or both be omitted",
    );
  }

  return {
    host: parsed.HOST ?? "0.0.0.0",
    port: parsed.PORT ?? 7370,
    apiPort: parsed.MAIL_API_PORT,
    smtpPort: parsed.MAIL_SMTP_PORT,
    databasePath: parsed.MAIL_DATABASE_PATH ?? ":memory:",
    clients,
    fastmailHost: parsed.FASTMAIL_SMTP_HOST ?? "smtp.fastmail.com",
    fastmailPort: parsed.FASTMAIL_SMTP_PORT ?? 587,
    fastmailUsername: parsed.FASTMAIL_SMTP_USERNAME,
    fastmailPassword: parsed.FASTMAIL_SMTP_PASSWORD,
    fastmailRequireTls: parsed.FASTMAIL_SMTP_REQUIRE_TLS ?? true,
    smtpTlsCertPath: parsed.MAIL_SMTP_TLS_CERT_PATH,
    smtpTlsKeyPath: parsed.MAIL_SMTP_TLS_KEY_PATH,
    smtpHostname: parsed.MAIL_SMTP_HOSTNAME ?? "mail.mail.svc.cluster.local",
    relayEnabledFallback: parsed.MAIL_RELAY_ENABLED_FALLBACK !== "false",
    featureFlagsMode,
  };
}

export type MailFeatureFlagRuntime = {
  readonly initialized: boolean;
  readonly isRelayEnabled: () => Promise<boolean>;
  readonly getSettings: () => Promise<MailSettings>;
  readonly shutdown: () => Promise<void>;
};

export async function initMailFeatureFlags(options: {
  readonly config: MailServerConfig;
  readonly env?: EnvMap;
  readonly metrics?: FlagMetricsRecorder;
  readonly provider?: InitFeatureFlagsOptions["provider"];
}): Promise<MailFeatureFlagRuntime> {
  const { config } = options;
  const shouldInit =
    options.provider !== undefined ||
    (config.featureFlagsMode !== undefined &&
      config.featureFlagsMode !== "disabled");

  if (!shouldInit) {
    return {
      initialized: false,
      isRelayEnabled: () => Promise.resolve(config.relayEnabledFallback),
      getSettings: () => Promise.resolve(DEFAULT_MAIL_SETTINGS),
      shutdown: () => Promise.resolve(),
    };
  }

  const effectiveEnv: EnvMap =
    config.featureFlagsMode === undefined
      ? { ...(options.env ?? Bun.env), FEATURE_FLAGS_MODE: "disabled" }
      : (options.env ?? Bun.env);

  await initFeatureFlags({
    environment: effectiveEnv,
    ...(options.metrics === undefined ? {} : { metrics: options.metrics }),
    ...(options.provider === undefined ? {} : { provider: options.provider }),
    onInitializationFailure: (message) => {
      console.warn(
        JSON.stringify({
          message: "mail_flags_init_failed",
          service: "mail",
          error: message,
        }),
      );
    },
  });

  return {
    initialized: true,
    isRelayEnabled: async () => {
      try {
        const result = await isEnabled("mail-relay-enabled", {
          default: config.relayEnabledFallback,
          targetingKey: "mail",
        });
        return result.value;
      } catch (error) {
        console.warn(
          JSON.stringify({
            message: "mail_flag_eval_failed",
            flag: "mail-relay-enabled",
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        return config.relayEnabledFallback;
      }
    },
    getSettings: async () => {
      try {
        const result = await stringValue("mail-settings", {
          default: DEFAULT_MAIL_SETTINGS_JSON,
          targetingKey: "mail",
        });
        return MailSettingsSchema.parse(result.value);
      } catch (error) {
        console.warn(
          JSON.stringify({
            message: "mail_settings_parse_failed",
            flag: "mail-settings",
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        return DEFAULT_MAIL_SETTINGS;
      }
    },
    shutdown: async () => {
      await shutdownFeatureFlags();
    },
  };
}
