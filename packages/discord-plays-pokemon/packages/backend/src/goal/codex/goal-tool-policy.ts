import path from "node:path";

/** Native file tools fail closed; the sole executable capability is pokemonctl. */
export function goalToolPolicy(
  environment: Record<string, string>,
  screenshotDirectory: string,
) {
  const env = Object.fromEntries(
    [
      "PATH",
      "HOME",
      "POKEMONCTL_URL",
      "POKEMONCTL_TOKEN",
      "POKEMONCTL_GOAL_ID",
    ].flatMap((name) =>
      environment[name] === undefined ? [] : [[name, environment[name]]],
    ),
  );
  return {
    default_permissions: "pokemon-goal",
    permissions: {
      "pokemon-goal": {
        filesystem: {
          ":minimal": "read",
          "/proc": "deny",
          [environment["CODEX_HOME"] ??
          path.join(environment["HOME"] ?? "/tmp", ".codex")]: "deny",
        },
        network: { enabled: false },
      },
    },
    shell_environment_policy: { inherit: "none", set: env },
    features: {
      shell_tool: false,
      apps: false,
      plugins: false,
      multi_agent: false,
      multi_agent_v2: false,
      view_image: false,
      browser_use: false,
      computer_use: false,
      in_app_browser: false,
      browser_use_external: false,
      image_generation: false,
      goals: false,
      code_mode_host: true,
    },
    mcp_servers: {
      pokemon: {
        command: process.execPath,
        args: [path.resolve(import.meta.dir, "../control/pokemonctl-mcp.ts")],
        env: { ...env, POKEMONCTL_SCREENSHOT_DIRECTORY: screenshotDirectory },
        required: true,
        enabled_tools: ["pokemonctl"],
        tools: { pokemonctl: { approval_mode: "approve" } },
      },
    },
  };
}
