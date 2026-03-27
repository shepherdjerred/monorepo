export const config = {
  port: Number(Bun.env["PORT"] ?? "3000"),
  authToken: Bun.env["AUTH_TOKEN"] ?? "",
  databaseUrl: Bun.env["DATABASE_URL"] ?? "file:./dev.db",
};
