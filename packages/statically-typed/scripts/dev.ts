import { buildSite } from "./build.ts";
import { startPreview } from "./preview.ts";

await buildSite();
const server = await startPreview();
process.stdout.write(`Statically Typed preview: ${String(server.url)}\n`);
