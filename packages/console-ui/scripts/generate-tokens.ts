import path from "node:path";
import { renderTokensCss } from "@shepherdjerred/console-ui/tokens.ts";

const target = path.join(import.meta.dirname, "../src/styles/tokens.css");
await Bun.write(target, renderTokensCss());
