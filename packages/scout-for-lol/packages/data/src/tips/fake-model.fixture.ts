import {
  type TipModel,
  type TipModelRequest,
  type TipModelResult,
  TipOutputError,
  type WikiLookup,
} from "#src/tips/model.ts";
import type { WikiRevisions } from "#src/tips/schema.ts";

export type FakeCall = {
  system: string;
  prompt: string;
  schemaName: string;
  /** Whether the request offered the wiki `lookup` tool. */
  hasLookup: boolean;
};

export type FakeTipModel = TipModel & { calls: FakeCall[] };

export const FAKE_CALL_COST_USD = 0.01;

/**
 * A model that answers from a function and records every call. An answer that
 * does not fit the requested schema fails the way the real runtime does, as a
 * billed `TipOutputError`. The responder gets the `lookup` tool the request
 * offered, and every call it makes is counted like a real tool call.
 */
export function fakeTipModel(
  respond: (
    call: FakeCall,
    index: number,
    lookup: WikiLookup | undefined,
  ) => unknown,
  name = "fake-model",
): FakeTipModel {
  const calls: FakeCall[] = [];
  const usage = {
    inputTokens: 1000,
    outputTokens: 200,
    cachedInputTokens: 0,
    costUsd: FAKE_CALL_COST_USD,
  };
  return {
    name,
    pricing: { inputPerMTok: 1, outputPerMTok: 5 },
    calls,
    generate: async <T>(
      request: TipModelRequest<T>,
    ): Promise<TipModelResult<T>> => {
      const call: FakeCall = {
        system: request.system,
        prompt: request.prompt,
        schemaName: request.schemaName,
        hasLookup: request.lookup !== undefined,
      };
      calls.push(call);
      let toolCalls = 0;
      const lookedUp: Record<string, number> = {};
      const counted: WikiLookup | undefined =
        request.lookup === undefined
          ? undefined
          : async (title) => {
              toolCalls += 1;
              const result = await request.lookup?.(title);
              if (result === undefined) {
                throw new Error("the fake model has no lookup tool");
              }
              Object.assign(lookedUp, result.pages);
              return result;
            };
      const parsed = request.schema.safeParse(
        await respond(call, calls.length - 1, counted),
      );
      if (!parsed.success) {
        throw new TipOutputError("the answer did not match the schema", usage);
      }
      const pages: WikiRevisions = lookedUp;
      return {
        object: parsed.data,
        usage,
        cached: false,
        toolCalls,
        lookedUp: pages,
      };
    },
  };
}

/** Tips as a model drafts them: each names the sources it rests on. */
export function withBasis<
  T extends { text: string; cites: readonly unknown[] },
>(
  tips: readonly T[],
  basis: readonly string[] = ["ability-facts"],
): (T & { basis: readonly string[] })[] {
  return tips.map((tip) => ({ ...tip, basis }));
}

/** The "charmed" glossary entry as a model proposes it: no cites, no numbers. */
export const CHARMED_DRAFT = {
  id: "charmed",
  term: "Charmed",
  aliases: ["charm", "charms"],
  definition: "Walks toward the caster and cannot attack or cast.",
};
