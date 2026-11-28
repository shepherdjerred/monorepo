import { createHash } from "node:crypto";
import type { z } from "zod";
import type {
  CreateExperimentSchema,
  Experiment,
  ExperimentListQuery,
  ExperimentSummary,
} from "./contract.ts";
import {
  applyExperimentCommand,
  createExperiment,
  ExperimentFailure,
  type ExperimentCommand,
  type ExperimentState,
  type ExperimentWriteContext,
  isDue,
  summaryOf,
} from "./domain.ts";

export type ExperimentWrite =
  | { kind: "create"; input: z.infer<typeof CreateExperimentSchema> }
  | { id: string; command: ExperimentCommand };

export type ExperimentStore = {
  list: (
    query: ExperimentListQuery,
    today: string,
  ) => Promise<ExperimentSummary[]>;
  find: (id: string, today: string) => Promise<Experiment | null>;
  countDue: (today: string) => Promise<number>;
  write: (
    write: ExperimentWrite,
    context: ExperimentWriteContext,
  ) => Promise<Experiment>;
  ping: () => Promise<boolean>;
  close: () => Promise<void>;
};

export type Receipt = { fingerprint: string };

export function requestIdOf(write: ExperimentWrite): string {
  return "id" in write ? write.command.input.requestId : write.input.requestId;
}

export function fingerprintOf(write: ExperimentWrite, actor: string): string {
  return createHash("sha256")
    .update(JSON.stringify({ write, actor }))
    .digest("hex");
}

export function checkFingerprint(receipt: Receipt, fingerprint: string) {
  if (receipt.fingerprint !== fingerprint) {
    throw new ExperimentFailure(
      409,
      "request_id_conflict",
      "This request ID was already used for a different operation",
    );
  }
}

export function nextMutation(
  write: ExperimentWrite,
  state: ExperimentState | undefined,
  context: ExperimentWriteContext,
) {
  if (!("id" in write))
    return createExperiment(
      crypto.randomUUID(),
      write.input,
      context.actor,
      context.at,
    );
  if (state === undefined) {
    throw new ExperimentFailure(404, "not_found", "Experiment not found");
  }
  return applyExperimentCommand(state, write.command, context);
}

export function createMemoryExperimentStore(): ExperimentStore {
  const records = new Map<string, Experiment>();
  const receipts = new Map<string, Receipt & { result: Experiment }>();
  return {
    list(query, today) {
      const text = query.q?.toLowerCase() ?? "";
      const views = { drafts: "draft", running: "running", decided: "decided" };
      const items = [...records.values()].filter((experiment) => {
        const matchesText =
          experiment.id === text ||
          [experiment.title, experiment.owner].some((value) =>
            value.toLowerCase().includes(text),
          );
        if (!matchesText) return false;
        return query.view === "due"
          ? isDue(experiment, today)
          : query.view === undefined ||
              query.view === "all" ||
              experiment.status === views[query.view];
      });
      items.sort((a, b) =>
        query.view === "due"
          ? (a.reviewDate ?? "").localeCompare(b.reviewDate ?? "") ||
            a.id.localeCompare(b.id)
          : b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
      );
      return Promise.resolve(
        items.map(({ timeline: _timeline, isDue: _isDue, ...state }) =>
          summaryOf(state, today),
        ),
      );
    },
    find(id, today) {
      const record = records.get(id);
      return Promise.resolve(
        record === undefined
          ? null
          : { ...record, isDue: isDue(record, today) },
      );
    },
    countDue(today) {
      return Promise.resolve(
        [...records.values()].filter((record) => isDue(record, today)).length,
      );
    },
    write(write, context) {
      const requestId = requestIdOf(write);
      const fingerprint = fingerprintOf(write, context.actor);
      const receipt = receipts.get(requestId);
      if (receipt !== undefined) {
        checkFingerprint(receipt, fingerprint);
        return Promise.resolve(receipt.result);
      }

      const previous = "id" in write ? records.get(write.id) : undefined;
      const { state, event } = nextMutation(write, previous, context);
      const result = {
        ...state,
        isDue: isDue(state, context.today),
        timeline: [...(previous?.timeline ?? []), event],
      };
      records.set(result.id, result);
      receipts.set(requestId, { fingerprint, result });
      return Promise.resolve(result);
    },
    ping: () => Promise.resolve(true),
    close: () => Promise.resolve(),
  };
}
