import type { CodexOptions } from "@openai/codex-sdk";
import { PROVIDER_CREDENTIAL_ENV_VARS } from "#shared/agent/provider-credentials.ts";
import type { codexScopedPermissions } from "./policy.ts";

export const CODEX_TOOL_ENVIRONMENT_CONFIG = {
  allow_login_shell: false,
  shell_environment_policy: {
    inherit: "all",
    ignore_default_excludes: false,
    exclude: [...PROVIDER_CREDENTIAL_ENV_VARS],
    experimental_use_profile: false,
  },
};

export function codexToolOptions(
  options: CodexOptions,
  scoped: ReturnType<typeof codexScopedPermissions>,
): CodexOptions {
  return {
    ...options,
    config: {
      ...options.config,
      ...CODEX_TOOL_ENVIRONMENT_CONFIG,
      ...scoped?.config,
    },
    ...(scoped === undefined
      ? {}
      : {
          configOverrides: [
            ...(options.configOverrides ?? []),
            ...scoped.configOverrides,
          ],
        }),
  };
}
