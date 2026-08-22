import { run, type RunOptions } from "@shepherdjerred/root-scripts/lib/run.ts";

const STACKS_REL = "src/tofu";

export type TofuValidationContext = {
  stack: string;
  root: string;
  env: Record<string, string>;
  runOptions: RunOptions;
  localProviderRoot: string | null;
};

export function buildValidationEnv(
  encryptsState: boolean,
): Record<string, string> {
  return encryptsState
    ? {
        TF_VAR_tofu_state_encryption_passphrase:
          "ci-validation-state-passphrase",
      }
    : {};
}

function withCwd(options: RunOptions, cwd: string): RunOptions {
  return { ...options, cwd };
}

export async function validateTofu(
  context: TofuValidationContext,
): Promise<void> {
  const { stack, root, runOptions, localProviderRoot } = context;
  const stackDir =
    localProviderRoot === null
      ? `${root}/${STACKS_REL}/${stack}`
      : await prepareOpenRouterValidationStack(
          root,
          localProviderRoot,
          runOptions,
        );
  const stackArgument =
    localProviderRoot === null ? `${STACKS_REL}/${stack}` : stackDir;
  if (localProviderRoot !== null) {
    await run(
      [
        "tofu",
        "providers",
        "lock",
        `-fs-mirror=${localProviderRoot}/mirror`,
        "registry.opentofu.org/shepherdjerred/openrouter-byok",
      ],
      withCwd(runOptions, stackDir),
    );
  }
  await run(
    [
      "tofu",
      `-chdir=${stackArgument}`,
      "init",
      "-backend=false",
      "-input=false",
    ],
    runOptions,
  );
  await run(["tofu", `-chdir=${stackArgument}`, "validate"], runOptions);
  console.log(`--- validated: ${stack}`);
}

async function prepareOpenRouterValidationStack(
  root: string,
  localProviderRoot: string,
  runOptions: RunOptions,
): Promise<string> {
  const stackDir = `${localProviderRoot}/validation/${STACKS_REL}/openrouter`;
  await run(
    ["mkdir", "-p", `${localProviderRoot}/validation/${STACKS_REL}`],
    runOptions,
  );
  await run(
    [
      "cp",
      "-R",
      `${root}/${STACKS_REL}/openrouter`,
      `${localProviderRoot}/validation/${STACKS_REL}/`,
    ],
    runOptions,
  );
  await run(["rm", "-rf", `${stackDir}/.terraform`], runOptions);
  return stackDir;
}
