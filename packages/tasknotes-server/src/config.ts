const configuredHost = Bun.env["HOST"]?.trim();

export const config = {
  authToken: Bun.env["AUTH_TOKEN"] ?? "",
  host:
    configuredHost === undefined || configuredHost.length === 0
      ? "127.0.0.1"
      : configuredHost,
  port: Number(Bun.env["PORT"] ?? 3000),
};
