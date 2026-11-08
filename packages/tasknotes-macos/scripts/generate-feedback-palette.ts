import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { cueNames, sampleRate, synthesizeCue } from "./feedback-synthesis.ts";

export const presentationDirectory = fileURLToPath(
  new URL("../../tasknotes-fixtures/presentation/", import.meta.url),
);

export function constantSchema(value: unknown): Record<string, unknown> {
  if (value === null) return { type: "null", const: null };
  if (Array.isArray(value)) return { type: "array", const: value };
  if (typeof value === "object") {
    return {
      type: "object",
      additionalProperties: false,
      required: Object.keys(value),
      properties: Object.fromEntries(
        Object.entries(value).map(([key, child]) => [
          key,
          constantSchema(child),
        ]),
      ),
    };
  }
  return { type: typeof value, const: value };
}

export async function paletteOutputs(
  directory = presentationDirectory,
): Promise<Map<string, Uint8Array>> {
  const output = new Map<string, Uint8Array>();
  const cues = Object.fromEntries(
    cueNames.map((name) => {
      const bytes = synthesizeCue(name);
      output.set(`audio/${name}.wav`, bytes);
      return [
        name,
        {
          file: `${name}.wav`,
          milliseconds: ((bytes.length - 44) / 2 / sampleRate) * 1000,
          sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
        },
      ];
    }),
  );
  const palette = {
    schemaVersion: 1,
    license: "GPL-3.0-only",
    provenance: "first-party-procedural-integer-synthesis",
    sampleRate,
    channels: 1,
    bitsPerSample: 16,
    maximumMilliseconds: 220,
    maximumPeakDbFS: -9,
    cues,
  };
  const encode = async (value: unknown): Promise<Uint8Array> => {
    const formatter = Bun.spawn(
      [
        fileURLToPath(
          new URL("../../../node_modules/.bin/prettier", import.meta.url),
        ),
        "--parser",
        "json",
      ],
      {
        stdin: new TextEncoder().encode(JSON.stringify(value)),
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [text, error, status] = await Promise.all([
      new Response(formatter.stdout).text(),
      new Response(formatter.stderr).text(),
      formatter.exited,
    ]);
    if (status !== 0)
      throw new Error(`Feedback JSON formatter failed: ${error}`);
    return new TextEncoder().encode(text);
  };
  output.set("audio/palette.json", await encode(palette));
  const policy: unknown = await Bun.file(`${directory}/feedback.json`).json();
  output.set(
    "feedback.schema.json",
    await encode({
      title: "Facet native feedback and procedural palette",
      $ref: "#/$defs/feedback",
      $defs: {
        feedback: constantSchema(policy),
        palette: constantSchema(palette),
      },
    }),
  );
  return output;
}

export async function producePalette(
  write: boolean,
  directory = presentationDirectory,
): Promise<void> {
  const output = await paletteOutputs(directory);
  if (write) await mkdir(`${directory}/audio`, { recursive: true });
  for (const [relative, expected] of output) {
    const path = `${directory}/${relative}`;
    if (write) await Bun.write(path, expected);
    else {
      const actual = new Uint8Array(await Bun.file(path).arrayBuffer());
      if (
        actual.length !== expected.length ||
        actual.some((value, index) => value !== expected[index])
      )
        throw new Error(`Feedback producer drift: ${relative}`);
    }
  }
}

if (import.meta.main) {
  const argument = Bun.argv[2];
  if (argument !== "--write" && argument !== "--check")
    throw new Error("Use --write or --check explicitly.");
  await producePalette(argument === "--write");
}
