import type {
  DiscordAccountId,
  DiscordChannelId,
  ExploreMessage,
  ExploreStreamEvent,
} from "@scout-for-lol/data";
import type { LlmSubject } from "@shepherdjerred/llm-observability/subject";
import type { ExploreSurface } from "#src/explore/surface.ts";

export type ExploreAgentParams = {
  model?: string;
  runId: string;
  conversationId: string;
  /**
   * Who this turn is being answered for. Required rather than optional: an
   * Explore turn always has an asker, and an optional field would quietly
   * produce unattributed spend the first time a caller forgot it.
   */
  subject: LlmSubject;
  question: string;
  /** Prior turns of this conversation, oldest first. */
  history: ExploreMessage[];
  /**
   * The asker's Discord servers. Alias resolution, profile links and
   * server-specific tools stay bounded to servers this person belongs to.
   */
  guildIds: string[];
  /**
   * The asker, used for requester-scoped tools, spending and authorization.
   */
  requesterId: DiscordAccountId;
  /** Discord-originated dare drafts keep the invoking channel as metadata. */
  originChannelId: DiscordChannelId | null;
  /**
   * Which product surface this turn is answered on. Creation tools are
   * web-only; see `explore/surface.ts` for why that is structural rather than
   * a policy choice.
   */
  surface: ExploreSurface;
  abortSignal: AbortSignal;
  emit: (event: ExploreStreamEvent) => void | Promise<void>;
};
