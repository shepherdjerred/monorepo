import path from "node:path";
import { z } from "zod";
import {
  atomicJSON,
  clientState,
  uuid,
  validate,
  type Client,
  type Manifest,
} from "../model";

export async function localControl(
  manifest: Manifest,
  client: Client,
  kind: "refresh" | "interrupt" | "resume",
  profileID?: string,
) {
  const state = clientState(manifest, client);
  const directory = path.join(state.stateDirectory, "control");
  const commandID = crypto.randomUUID();
  const message = {
    schemaVersion: 1,
    runID: manifest.runID,
    commandID,
    kind,
    ...(profileID === undefined ? {} : { profileID }),
  };
  validate("command", message);
  await atomicJSON(path.join(directory, "command.json"), message);
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const resultFile = Bun.file(path.join(directory, "result.json"));
    if (await resultFile.exists()) {
      const value: unknown = await resultFile.json();
      validate("result", value);
      const result = z
        .object({
          runID: uuid,
          commandID: uuid,
          outcome: z.enum(["applied", "rejected"]),
        })
        .parse(value);
      if (result.runID.toLowerCase() !== manifest.runID)
        throw new Error("Wrong control acknowledgement run");
      if (result.commandID === commandID) {
        if (result.outcome !== "applied")
          throw new Error("Acceptance control rejected the command");
        console.log(`${client}: ${kind} acknowledged`);
        return;
      }
    }
    await Bun.sleep(250);
  }
  throw new Error("Acceptance control acknowledgement deadline exceeded");
}
