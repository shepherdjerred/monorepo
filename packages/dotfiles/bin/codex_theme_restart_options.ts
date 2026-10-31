export type Appearance = "light" | "dark";

export type Options = {
  dryRun: boolean;
  onChange: boolean;
  worker: boolean;
  probeIdentities: boolean;
  terminal?: string;
};

function optionValue(flag: string, value: string | undefined): string {
  if (value === undefined || value.length === 0 || value.startsWith("-")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function parseOptions(args: readonly string[]): Options {
  const options: Options = {
    dryRun: false,
    onChange: false,
    worker: false,
    probeIdentities: false,
  };
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === undefined) throw new Error("Missing option");
    switch (flag) {
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--on-change":
        options.onChange = true;
        break;
      case "--worker":
        options.worker = true;
        break;
      case "--probe-identities":
        options.probeIdentities = true;
        break;
      case "--terminal":
        options.terminal = optionValue(flag, args[++index]);
        break;
      default:
        throw new Error(`Unknown option: ${flag}`);
    }
  }
  if (options.probeIdentities && (options.dryRun || options.onChange))
    throw new Error(
      "--probe-identities cannot be combined with --dry-run or --on-change",
    );
  if (options.onChange && options.terminal !== undefined) {
    throw new Error("--on-change covers all local terminals");
  }
  return options;
}
