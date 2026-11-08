import { FileOperations } from "./operations.ts";
import { z } from "zod";

const InputSchema = z.object({
  roots: z.object({
    downloads: z.string(),
    library: z.string(),
    control: z.string(),
  }),
  phase: z.string(),
  input: z.object({
    operationId: z.string(),
    downloadPath: z.string(),
    libraryPath: z.string(),
    sha256: z.string(),
    previousSha256: z.string(),
  }),
});
const encoded = process.argv[2];
if (encoded === undefined) throw new Error("Crash fixture input required");
const fixture = InputSchema.parse(JSON.parse(encoded));
const operations = new FileOperations(fixture.roots, {
  minimumFreeBytes: 0,
  authorize: async () => {
    /* Isolated fixture authorization. */
  },
  checkpoint: async (phase) => {
    if (phase !== fixture.phase) return;
    process.stdout.write("ready\n");
    await new Promise<void>((resolve) => {
      process.once("SIGTERM", () => {
        resolve();
      });
    });
  },
});
await operations.importFile(fixture.input);
