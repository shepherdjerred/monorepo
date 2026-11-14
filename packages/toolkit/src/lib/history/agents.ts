import { z } from "zod";
import {
  HISTORY_SOURCE_NAMES,
  HistorySourceNameSchema,
  isMirrorSource,
  type HistorySourceName,
} from "#lib/history/types.ts";

/**
 * The user-facing agent behind a history source. A mirror source
 * (`<agent>-mirror`) holds another machine's sessions of the same agent, so
 * `claude` and `claude-mirror` are both Claude Code; the session's `machine`
 * is what tells them apart.
 */
const MIRROR_SUFFIX = "-mirror";

export type HistoryAgentName = Exclude<HistorySourceName, `${string}-mirror`>;

const AgentSourceSchema = z.custom<HistoryAgentName>(
  (value) =>
    HistorySourceNameSchema.safeParse(value).success &&
    typeof value === "string" &&
    !isMirrorSource(value),
);

export const HISTORY_AGENT_NAMES: readonly HistoryAgentName[] =
  HISTORY_SOURCE_NAMES.flatMap((source) => {
    const agent = AgentSourceSchema.safeParse(source);
    return agent.success ? [agent.data] : [];
  });

export const HistoryAgentNameSchema = z.enum(HISTORY_AGENT_NAMES);

/** The agent a source's sessions belong to; a mirror maps to its base agent. */
export function historyAgentOf(source: HistorySourceName): HistoryAgentName {
  const base = isMirrorSource(source)
    ? source.slice(0, -MIRROR_SUFFIX.length)
    : source;
  const agent = HistoryAgentNameSchema.safeParse(base);
  if (!agent.success) {
    throw new Error(`History source ${source} has no agent source ${base}`);
  }
  return agent.data;
}

/** Every source whose sessions belong to `agent`, the agent's own first. */
export function sourcesOfAgent(
  agent: HistoryAgentName,
): readonly HistorySourceName[] {
  return HISTORY_SOURCE_NAMES.filter(
    (source) => historyAgentOf(source) === agent,
  );
}
