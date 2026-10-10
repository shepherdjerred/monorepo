/** `build note`, `build log` and `build resume`: the journal's CLI. */
import { appendLog, readLog } from "./build-log.ts";
import { print, type Handler } from "./command-kit.ts";
import { renderResume, resumeState } from "./resume.ts";

type Values = { json: boolean; tail?: string };

export const LOG_USAGE = `  note <dir> "<text>"                   Append an observation to the build's journal
  log <dir> [--tail n]                   Print the journal (what happened, when, which iteration)
  resume <dir> [--tail n]                Brief, notes, journal and state for a fresh context (no next steps)`;

export const LOG_HANDLERS: Record<string, Handler<Values>> = {
  note: async (_env, dir, values, rest) => {
    const text = rest.join(" ").trim();
    if (text.length === 0) {
      throw new Error('note needs text: toolkit mc build note <dir> "<text>"');
    }
    const entry = await appendLog(dir, { kind: "note", text });
    print(
      values.json,
      entry,
      `noted at iteration ${entry.iteration.toString()}`,
    );
    return 0;
  },
  log: async (_env, dir, values) => {
    const entries = await readLog(dir);
    const tail =
      values.tail === undefined ? entries.length : Number(values.tail);
    const shown = entries.slice(-tail);
    print(
      values.json,
      shown,
      shown.length === 0
        ? "journal is empty"
        : shown
            .map(
              (entry) =>
                `${entry.at} [${entry.iteration.toString()}] ${entry.kind} ${JSON.stringify(
                  Object.fromEntries(
                    Object.entries(entry).filter(
                      ([key]) =>
                        key !== "at" && key !== "iteration" && key !== "kind",
                    ),
                  ),
                )}`,
            )
            .join("\n"),
    );
    return 0;
  },
  resume: async (_env, dir, values) => {
    const state = await resumeState(dir);
    await appendLog(dir, { kind: "resume" });
    print(
      values.json,
      state,
      renderResume(
        state,
        values.tail === undefined ? {} : { tail: Number(values.tail) },
      ),
    );
    return 0;
  },
};
