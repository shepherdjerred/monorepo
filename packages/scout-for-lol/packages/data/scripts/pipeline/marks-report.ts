// Agreement of each judge and pass with Jerred's marks (the `marks` export of
// the review artifact). Reads marks.json, the first review set (the judges'
// verdicts on every tip) and, when it exists, review-set-v2.json (each pass's
// verdict in a tip's history). Prints a markdown report.
//
//   pipeline/marks-report.ts [--marks <file>] [--v1 <file>] [--v2 <file>]

import { parseArgs } from "node:util";
import { z } from "zod";
import { MARKS_PATH, type Mark, readMarks } from "./marks.ts";

const DIRECTORY = "/Users/jerred/.local/share/scout-redesign/tips-review";

const V1Schema = z.array(
  z.object({
    tips: z.array(
      z.object({
        id: z.string(),
        judges: z.object({
          sonnet: z.object({ verdict: z.string() }).nullable(),
          decisions: z.object({ verdict: z.string() }).nullable(),
        }),
      }),
    ),
  }),
);

const V2Schema = z.array(
  z.object({
    tips: z.array(
      z.object({
        id: z.string(),
        history: z.array(z.object({ pass: z.string() }).loose()),
      }),
    ),
    droppedTips: z.array(z.object({ id: z.string() })),
  }),
);

type Row = { verdicts: Map<string, string> };

/** How one judge or pass did on the marked tips it saw. */
function summarise(
  marks: readonly Mark[],
  verdictOf: (mark: Mark) => string | undefined,
): {
  n: number;
  wrongOnGood: number;
  wrongOnMeh: number;
  missedWrong: number;
  wrongMarks: number;
} {
  let n = 0;
  let wrongOnGood = 0;
  let wrongOnMeh = 0;
  let missedWrong = 0;
  let wrongMarks = 0;
  for (const mark of marks) {
    const verdict = verdictOf(mark);
    if (verdict === undefined) {
      continue;
    }
    n += 1;
    if (mark.verdict === "wrong") {
      wrongMarks += 1;
      missedWrong += verdict === "wrong" ? 0 : 1;
    } else if (verdict === "wrong") {
      wrongOnGood += mark.verdict === "good" ? 1 : 0;
      wrongOnMeh += mark.verdict === "meh" ? 1 : 0;
    }
  }
  return { n, wrongOnGood, wrongOnMeh, missedWrong, wrongMarks };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      marks: { type: "string", default: MARKS_PATH },
      v1: { type: "string", default: `${DIRECTORY}/review-set.json` },
      v2: { type: "string", default: `${DIRECTORY}/review-set-v2.json` },
      write: { type: "boolean", default: false },
    },
    strict: true,
  });
  const marks = await readMarks(values.marks);
  if (marks.length === 0) {
    console.log("No marks yet.");
    return;
  }
  const v1 = V1Schema.parse(await Bun.file(values.v1).json());
  const first = new Map<string, Row>(
    v1.flatMap((unit) =>
      unit.tips.map(
        (tip) =>
          [
            tip.id,
            {
              verdicts: new Map<string, string>([
                ...(tip.judges.sonnet === null
                  ? []
                  : [
                      [
                        "Sonnet medium (first review set)",
                        tip.judges.sonnet.verdict,
                      ] as const,
                    ]),
                ...(tip.judges.decisions === null
                  ? []
                  : [
                      [
                        "Decisions, likeliest answer (first review set)",
                        tip.judges.decisions.verdict,
                      ] as const,
                    ]),
              ]),
            },
          ] as const,
      ),
    ),
  );
  const rows = new Map<string, (mark: Mark) => string | undefined>();
  for (const label of [
    "Sonnet medium (first review set)",
    "Decisions, likeliest answer (first review set)",
  ]) {
    rows.set(label, (mark) => first.get(mark.tipId)?.verdicts.get(label));
  }
  const v2File = Bun.file(values.v2);
  if (await v2File.exists()) {
    const v2 = V2Schema.parse(await v2File.json());
    const tips = new Map(
      v2.flatMap((unit) => unit.tips.map((tip) => [tip.id, tip] as const)),
    );
    const dropped = new Set(
      v2.flatMap((unit) => unit.droppedTips.map((tip) => tip.id)),
    );
    const history = (id: string, pass: string): string | undefined => {
      const entry = tips.get(id)?.history.find((h) => h.pass === pass);
      const verdict: unknown = entry?.["verdict"];
      return typeof verdict === "string" ? verdict : undefined;
    };
    for (const pass of [
      "triage",
      "escalate:lookup",
      "escalate:search",
      "escalate:recheck",
    ]) {
      rows.set(`${pass} (multi-pass run)`, (mark) => history(mark.tipId, pass));
    }
    rows.set("kept or dropped by the multi-pass run", (mark) =>
      tips.has(mark.tipId)
        ? "correct"
        : dropped.has(mark.tipId)
          ? "wrong"
          : undefined,
    );
  }

  const count = (verdict: Mark["verdict"]): number =>
    marks.filter((mark) => mark.verdict === verdict).length;
  const models = [...new Set(marks.map((mark) => mark.model ?? "unknown"))];
  const lines: string[] = [];
  const out = (line: string): void => {
    lines.push(line);
    console.log(line);
  };
  out(`# Agreement with Jerred's marks\n`);
  out(
    `${marks.length.toString()} marks so far (${count("good").toString()} good, ${count("meh").toString()} meh, ${count("wrong").toString()} wrong) on ${[...new Set(marks.map((mark) => mark.champion ?? "?"))].join(", ")}; models marked: ${models.join(", ")}. **This is a very small sample, not a measurement**: with no wrong marks yet only false alarms (a judge calling a tip he marked good wrong) can be counted, and recall cannot be measured at all.\n`,
  );
  out(
    "| Judge or pass | Marked tips it judged | Called wrong, he marked good | Called wrong, he marked meh | He marked wrong, it did not | He marked wrong |",
  );
  out("| --- | --- | --- | --- | --- | --- |");
  for (const [label, verdictOf] of rows) {
    const row = summarise(marks, verdictOf);
    out(
      `| ${label} | ${row.n.toString()} | ${row.wrongOnGood.toString()} | ${row.wrongOnMeh.toString()} | ${row.missedWrong.toString()} | ${row.wrongMarks.toString()} |`,
    );
  }
  if (values.write) {
    await Bun.write(
      `${import.meta.dir}/../../src/tips/eval/marks-agreement.md`,
      `${lines.join("\n")}\n`,
    );
  }
}

if (import.meta.main) {
  await main();
}
