import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { capturePrivateInstalledCorpus } from "#testing/corpus/capture/run.ts";
import {
  assertRecyclarrReference,
  captureSources,
} from "#testing/corpus/capture/configuration.ts";
import { validatePrivateCaptureDestination } from "#testing/corpus/capture/private.ts";
import {
  captureStage,
  captureDiagnostic,
} from "#testing/corpus/capture/diagnostics.ts";

async function configuration(reference: string) {
  assertRecyclarrReference(reference);
  const wrapper = fileURLToPath(
    new URL(
      "../../../../scripts/onepassword/with-service-account.sh",
      import.meta.url,
    ),
  );
  const child = Bun.spawn([wrapper, "op", "read", reference], {
    stdout: "pipe",
    stderr: "ignore",
    timeout: 30_000,
  });
  const reader = child.stdout.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > 1_000_000)
        throw new Error("Credential response exceeds bound");
      chunks.push(next.value);
    }
    if ((await child.exited) !== 0) throw new Error("Credential read failed");
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    await reader.cancel();
    child.kill();
    await child.exited;
  }
}
async function main() {
  const { values } = parseArgs({
    options: {
      directory: { type: "string" },
      "recyclarr-reference": { type: "string" },
      "radarr-url": { type: "string" },
      "sonarr-url": { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  if (
    values.directory === undefined ||
    values["recyclarr-reference"] === undefined ||
    values["radarr-url"] === undefined ||
    values["sonarr-url"] === undefined
  )
    throw new Error("Explicit capture arguments required");
  const worktree = fileURLToPath(
    new URL("../../../../", import.meta.url),
  ).replace(/\/$/u, "");
  const directory = values.directory;
  const reference = values["recyclarr-reference"];
  const overrides = {
    radarr: values["radarr-url"],
    sonarr: values["sonarr-url"],
  };
  await captureStage({ source: "local", stage: "destination" }, () =>
    validatePrivateCaptureDestination(directory, worktree),
  );
  const sources = await captureStage(
    { source: "local", stage: "configuration" },
    async () => captureSources(await configuration(reference), overrides),
  );
  const result = await capturePrivateInstalledCorpus({
    directory: values.directory,
    worktree,
    sources,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(
      "Private installed capture failed; inspect the reviewed source schema, stable snapshot and private destination. No source mutations were requested; incomplete private output has no completed manifest.",
    );
    console.error(
      JSON.stringify({
        captureFailure: captureDiagnostic(error, {
          source: "local",
          stage: "arguments",
        }).diagnostic,
      }),
    );
    process.exitCode = 1;
  }
}
