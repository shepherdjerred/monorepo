import { expect, test } from "vitest";
import { main, run, type Command } from "../bin/executable_update.ts";

const workstation = async () => "workstation";

test("propagates a failed command exit code", async () => {
  await expect(
    run({ executable: "sh", args: ["-c", "exit 17"] }),
  ).rejects.toThrow("[sh -c exit 17] exited with code 17");
});

test("stops before maintenance commands when chezmoi update fails", async () => {
  const commands: Command[] = [];
  const failedCommand: Command = { executable: "chezmoi", args: ["update"] };

  await expect(
    main(async (command) => {
      commands.push(command);
      if (command.executable === "chezmoi") {
        throw new Error("chezmoi failed");
      }
    }, workstation),
  ).rejects.toThrow("chezmoi failed");

  expect(commands).toEqual([failedCommand]);
});

test("runs chezmoi update without a redundant apply", async () => {
  const commands: Command[] = [];

  await main(async (command) => {
    commands.push(command);
  }, workstation);

  expect(commands).toContainEqual({ executable: "chezmoi", args: ["update"] });
  expect(commands).not.toContainEqual({
    executable: "chezmoi",
    args: ["apply"],
  });
});

test("exports the Brewfile on workstations only", async () => {
  const isBrewfileExport = (command: Command) =>
    command.args.some((arg) => arg.endsWith("/bin/write_brewfile.sh"));

  const workstationCommands: Command[] = [];
  await main(async (command) => {
    workstationCommands.push(command);
  }, workstation);
  expect(workstationCommands.some((command) => isBrewfileExport(command))).toBe(
    true,
  );

  const agentHostCommands: Command[] = [];
  await main(
    async (command) => {
      agentHostCommands.push(command);
    },
    async () => "agent-host",
  );
  expect(agentHostCommands.some((command) => isBrewfileExport(command))).toBe(
    false,
  );
});
