/**
 * Where the eval and pipeline scripts write their raw JSON: per-run reports,
 * judge verdicts and samples. The files are large and regenerable, so the
 * directory is ignored by version control and the evidence a change rests on is
 * attached to its pull request; only the small summaries beside this file are
 * committed.
 */
export const EVAL_RAW_DIRECTORY = `${import.meta.dir}/../../../.tips-eval`;
