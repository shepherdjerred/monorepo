import { z } from "zod";

const integer = z
  .string()
  .regex(/^-?\d+$/u)
  .transform(Number)
  .pipe(z.int());
const count = integer.pipe(z.number().nonnegative());
const positive = count.pipe(z.number().positive());
const decimal = z
  .string()
  .regex(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu)
  .transform(Number)
  .pipe(z.number());
const name = z.string().regex(/^[a-z0-9][a-z0-9_.:-]{0,63}$/u);
const pseudonym = z.string().regex(/^[a-z][a-z0-9]*$/u);
const mapId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const team = z.enum(["RED", "BLUE", "GREEN", "PURPLE", "YELLOW"]);
const bomb = z.string().regex(/^[a-z0-9][a-z0-9-]*$/u);
const bombStatus = z.enum(["IDLE", "ARMING", "ARMED", "DEFUSING", "DESTROYED"]);

function pairs(text: string): [string, string][] {
  if (text === "") return [];
  const entries = text
    .split(",")
    .map((part) =>
      z.tuple([z.string().min(1), z.string().min(1)]).parse(part.split("=")),
    );
  if (new Set(entries.map(([key]) => key)).size !== entries.length) {
    throw new Error("repeated occurrence key");
  }
  return entries;
}

const ballot = z
  .tuple([z.literal("V"), count, mapId])
  .rest(z.string())
  .superRefine((row, ctx) => {
    const candidates: string[] = [];
    if (row.length < 5 || row.length % 2 === 0) {
      ctx.addIssue({
        code: "custom",
        message: "a ballot pairs each map with its votes",
      });
      return;
    }
    for (let index = 3; index < row.length; index += 2) {
      candidates.push(mapId.parse(row[index]));
      count.parse(row[index + 1]);
    }
    if (
      new Set(candidates).size !== candidates.length ||
      !candidates.includes(row[2])
    ) {
      ctx.addIssue({
        code: "custom",
        message: "distinct ballot candidates must include the chosen map",
      });
    }
  });

const kill = z
  .tuple([
    z.literal("D"),
    count,
    pseudonym,
    z.union([pseudonym, z.literal("-")]),
    z
      .string()
      .regex(/^[^\t\n]+$/u)
      .refine((cause) => cause.trim() !== "", "kill cause must not be blank"),
    z.union([name, z.literal("-")]),
    z.union([decimal.pipe(z.number().nonnegative()), z.literal("-")]),
  ])
  .rest(z.string())
  .superRefine((row, ctx) => {
    const assistants = new Set<string>();
    for (const value of row.slice(7)) {
      const text = z.string().parse(value);
      const [who] = z
        .tuple([pseudonym, decimal.pipe(z.number().positive().max(1))])
        .parse(text.split("="));
      if (assistants.has(who) || who === row[2] || who === row[3]) {
        ctx.addIssue({
          code: "custom",
          message: "invalid or repeated kill assistant",
        });
      }
      assistants.add(who);
    }
  });

const chat = z
  .tuple([z.literal("C"), count, pseudonym, name, positive, z.string()])
  .superRefine((row, ctx) => {
    if (row[5] !== "" && row[5].length !== row[4]) {
      ctx.addIssue({
        code: "custom",
        message: "recorded chat length differs from text",
      });
    }
  });

/** Schema 4's structured rows, retained alongside trajectories rather than discarded. */
const OccurrenceSchema = z.union([
  z.tuple([
    z.literal("B"),
    count,
    integer,
    integer,
    integer,
    z.string().regex(/^\S+$/u),
    z.enum(["CRATER", "REVERT", "BARRICADE", "BANNER"]),
  ]),
  z.tuple([
    z.literal("J"),
    count,
    pseudonym,
    name,
    decimal,
    decimal,
    decimal,
    decimal,
    decimal,
    decimal,
  ]),
  z.tuple([
    z.literal("A"),
    count,
    pseudonym,
    name,
    z.union([name, z.literal("")]),
  ]),
  z.tuple([z.literal("U"), count, pseudonym, name, count, count]),
  z.tuple([z.literal("K"), count, pseudonym, name, positive]),
  chat,
  ballot,
  kill,
  z.tuple([
    z.literal("S"),
    count,
    z.enum(["WAITING", "WARNED", "DEADLY"]),
    z.string().transform((text) =>
      z
        .array(z.tuple([team, count]))
        .nonempty()
        .parse(pairs(text)),
    ),
    z
      .string()
      .transform((text) =>
        z.array(z.tuple([bomb, bombStatus])).parse(pairs(text)),
      ),
  ]),
]);

export type OccurrenceRow = z.infer<typeof OccurrenceSchema>;
export const occurrenceTags = new Set([
  "B",
  "J",
  "A",
  "U",
  "K",
  "C",
  "V",
  "D",
  "S",
]);

/** Decode the wire escaping before validating the occurrence's exact shape and values. */
function unescape(field: string): string {
  let decoded = "";
  for (let index = 0; index < field.length; index++) {
    const character = field.charAt(index);
    if (character !== "\\") {
      decoded += character;
      continue;
    }
    const code = field[++index];
    switch (code) {
      case "t":
        decoded += "\t";
        break;
      case "n":
        decoded += "\n";
        break;
      case "\\":
        decoded += "\\";
        break;
      case undefined:
      default:
        throw new Error("unknown or dangling record escape");
    }
  }
  return decoded;
}

export function readOccurrence(fields: string[]): OccurrenceRow {
  return OccurrenceSchema.parse(fields.map((field) => unescape(field)));
}
