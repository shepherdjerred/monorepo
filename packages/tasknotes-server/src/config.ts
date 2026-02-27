export const config = {
  vaultPath: Bun.env["VAULT_PATH"] ?? "./vault",
  tasksDir: Bun.env["TASKS_DIR"] ?? "",
  authToken: Bun.env["AUTH_TOKEN"] ?? "",
  port: Number(Bun.env["PORT"] ?? 3000),
};
