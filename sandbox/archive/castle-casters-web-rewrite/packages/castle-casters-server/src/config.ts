export type ServerConfig = {
  port: number;
  sentryDsn?: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const port = Number(env["CASTLE_CASTERS_PORT"] ?? "4174");
  const config: ServerConfig = {
    port: Number.isFinite(port) ? port : 4174,
  };
  if (env["SENTRY_DSN"] !== undefined) {
    config.sentryDsn = env["SENTRY_DSN"];
  }
  return config;
}
