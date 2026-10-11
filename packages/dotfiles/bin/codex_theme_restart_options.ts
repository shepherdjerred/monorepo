export type Appearance = "light" | "dark";

export type Options = {
  dryRun: boolean;
  onChange: boolean;
  worker: boolean;
  session?: string;
  pane?: string;
};

function optionValue(flag: string, value: string | undefined): string {
  if (value === undefined || value.length === 0 || value.startsWith("-")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function parseOptions(args: readonly string[]): Options {
  const options: Options = { dryRun: false, onChange: false, worker: false };
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
      case "--session":
      case "--pane": {
        const value = optionValue(flag, args[++index]);
        if (flag === "--session") options.session = value;
        else options.pane = value;
        break;
      }
      default:
        throw new Error(`Unknown option: ${flag}`);
    }
  }
  if (options.pane !== undefined && options.session === undefined)
    throw new Error("--pane requires --session");
  if (
    options.onChange &&
    (options.session !== undefined || options.pane !== undefined)
  ) {
    throw new Error("--on-change covers all local sessions");
  }
  return options;
}
