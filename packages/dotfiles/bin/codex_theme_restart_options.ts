export type Appearance = "light" | "dark";

export type Options = {
  dryRun: boolean;
  onChange: boolean;
  worker: boolean;
  probeIdentities: boolean;
  status: boolean;
  terminal?: string;
  wait?: boolean;
  interruptWorking?: boolean;
  expectedTurn?: number;
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
    status: false,
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
      case "--status":
        options.status = true;
        break;
      case "--terminal":
        options.terminal = optionValue(flag, args[++index]);
        break;
      case "--wait":
        options.wait = true;
        break;
      case "--interrupt-working":
        options.interruptWorking = true;
        break;
      case "--expected-turn": {
        const value = Number(optionValue(flag, args[++index]));
        if (!Number.isSafeInteger(value) || value < 0)
          throw new Error("--expected-turn requires a nonnegative integer");
        options.expectedTurn = value;
        break;
      }
      default:
        throw new Error(`Unknown option: ${flag}`);
    }
  }
  validateOptions(options);
  return options;
}

function validateOptions(options: Options): void {
  if (options.probeIdentities && (options.dryRun || options.onChange))
    throw new Error(
      "--probe-identities cannot be combined with --dry-run or --on-change",
    );
  if (
    options.status &&
    (options.dryRun ||
      options.onChange ||
      options.worker ||
      options.probeIdentities ||
      options.terminal !== undefined)
  )
    throw new Error("--status is a read-only report and takes no other option");
  if (options.onChange && options.terminal !== undefined) {
    throw new Error("--on-change covers all local terminals");
  }
  validateRestartPolicy(options);
}

function validateRestartPolicy(options: Options): void {
  const waiting = options.wait === true;
  const interrupting = options.interruptWorking === true;
  if (waiting || interrupting || options.expectedTurn !== undefined) {
    if (
      options.terminal === undefined ||
      options.status ||
      options.probeIdentities ||
      options.dryRun
    )
      throw new Error(
        "A wait or confirmed interrupt requires a manual --terminal restart",
      );
    if (
      (waiting && interrupting) ||
      (!interrupting && options.expectedTurn !== undefined)
    )
      throw new Error(
        "Choose either waiting or an interrupt confirmed for a specific turn",
      );
  }
}

export function usage(eventsPath: string, logTag: string): string {
  return `Usage: restart-codex-panes [--dry-run | --probe-identities | --on-change | --status] [--terminal ADDRESS] [--wait | --interrupt-working]
Restart each local Codex terminal so its \`codex\` wrapper relaunches it with the
theme for the current macOS appearance.
  (none)              restart now in an independent worker
  --on-change         reconcile live clients whose launch theme differs
  --dry-run           read-only preview of eligible terminals
  --probe-identities  read-only verification of Codex's hook and saved transcript
  --status            read-only report: last run, recorded vs current appearance,
                      and each live local Codex terminal's launch theme; exits 1 on
                      any mismatch or a failed last run
  --terminal ADDRESS  restrict a manual run to one hc address such as t7
  --wait              queue a restart for the current conversation when it is safely idle
  --interrupt-working interrupt the selected working turn before resuming the conversation
Each worker run appends one JSON line to ${eventsPath}
and mirrors its summary to the unified log:
  /usr/bin/log show --last 1d --style compact --predicate 'eventMessage CONTAINS "${logTag}"'`;
}
