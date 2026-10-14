import path from "node:path";
import { z } from "zod";

const uint = z.number().int().nonnegative();
const kinds = z.strictObject({
  hello: uint,
  video: uint,
  audio: uint,
  telemetry: uint,
  error: uint,
  saved: uint,
  input: uint,
  flush: uint,
  stop: uint,
});
const schema = z.strictObject({
  version: z.literal(1),
  magic: z.tuple([uint, uint, uint, uint]),
  headerBytes: z.literal(24),
  input: z.strictObject({
    bytes: z.literal(36),
    seat: z.literal(0),
    buttons: z.literal(4),
    stickX: z.literal(8),
    stickY: z.literal(12),
    cStickX: z.literal(16),
    cStickY: z.literal(20),
    triggerL: z.literal(24),
    triggerR: z.literal(28),
    clear: z.literal(32),
  }),
  offsets: z.strictObject({
    kind: z.literal(4),
    length: z.literal(8),
    sequence: z.literal(12),
    timeMs: z.literal(16),
  }),
  kinds,
  limits: kinds,
  padButtons: z.strictObject({
    left: uint,
    right: uint,
    down: uint,
    up: uint,
    z: uint,
    r: uint,
    l: uint,
    a: uint,
    b: uint,
    x: uint,
    y: uint,
    start: uint,
  }),
});
const root = path.resolve(import.meta.dirname, "../../../..");
const wire = schema.parse(
  await Bun.file(path.join(root, "runtimes/wire.json")).json(),
);
await Bun.write(
  path.join(root, "packages/common/src/wire.generated.ts"),
  `// Generated from runtimes/wire.json. Run the Arcade generate task.\nexport const wire = ${JSON.stringify(wire, null, 2).replaceAll(/\b\d{5,}\b/g, (value) => value.replaceAll(/\B(?=(?:\d{3})+(?!\d))/g, "_"))} as const;\n`,
);
const header = [
  "// Generated from runtimes/wire.json. Run the Arcade generate task.",
  "#pragma once",
  "#include <cstdint>",
  "namespace ArcadeWire {",
  `inline constexpr uint8_t Magic[] = {${wire.magic.join(",")}};`,
  `inline constexpr uint32_t HeaderBytes = ${String(wire.headerBytes)};`,
];
for (const [name, value] of Object.entries(wire.offsets))
  header.push(`inline constexpr uint32_t Offset_${name} = ${String(value)};`);
for (const [name, value] of Object.entries(wire.kinds))
  header.push(`inline constexpr uint32_t Kind_${name} = ${String(value)};`);
for (const [name, value] of Object.entries(wire.limits))
  header.push(`inline constexpr uint32_t Limit_${name} = ${String(value)};`);
for (const [name, value] of Object.entries(wire.padButtons))
  header.push(`inline constexpr uint32_t Pad_${name} = ${String(value)};`);
header.push("}");
await Bun.write(
  path.join(root, "runtimes/wire.generated.h"),
  header.join("\n") + "\n",
);
for (const [name, value] of Object.entries(wire.input))
  header.push(`inline constexpr uint32_t Input_${name} = ${String(value)};`);
const formatter = Bun.spawn(
  [
    "bunx",
    "prettier",
    "--write",
    path.join(root, "packages/common/src/wire.generated.ts"),
  ],
  { cwd: path.resolve(root, "../.."), stdout: "ignore", stderr: "inherit" },
);
if ((await formatter.exited) !== 0)
  throw new Error("Could not format the generated wire contract");
