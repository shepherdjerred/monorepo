import { expect, test } from "vitest";
import { main, run, type Command } from "../bin/executable_update.ts";

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
    }),
  ).rejects.toThrow("chezmoi failed");

  expect(commands).toEqual([failedCommand]);
});

test("runs chezmoi update without a redundant apply", async () => {
  const commands: Command[] = [];

  await main(async (command) => {
    commands.push(command);
  });

  expect(commands).toContainEqual({ executable: "chezmoi", args: ["update"] });
  expect(commands).not.toContainEqual({
    executable: "chezmoi",
    args: ["apply"],
  });
});
