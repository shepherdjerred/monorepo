import { ConfigSchema, type Config } from "#src/domain/schemas.ts";
import { runtimePaths, type RuntimePaths } from "#src/runtime/paths.ts";

export async function loadConfig(
  paths: RuntimePaths = runtimePaths(),
): Promise<Config> {
  const file = Bun.file(paths.config);
  if (!(await file.exists())) {
    throw new Error(
      `Missing config at ${paths.config}. Copy config.example.json there and replace every op:// reference.`,
    );
  }
  return ConfigSchema.parse(await file.json());
}
