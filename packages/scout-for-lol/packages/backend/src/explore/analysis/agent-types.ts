import type { DiscordGuildId } from "@scout-for-lol/domain/identity/discord.ts";
import type {
  DiscordAccountId,
  DiscordChannelId,
  ExploreMessage,
  ExploreStreamEvent,
} from "@scout-for-lol/data";
import type { LlmSubject } from "@shepherdjerred/llm-observability/subject";
import type { ExploreSurface } from "#src/explore/surface.ts";
import type { ToolPayloadCapture } from "#src/explore/inspection/tool-payloads.ts";

export type ExploreAgentParams = {
  /** Replays retain complete evidence locally; hosted turns use the database sink. */
  captureToolPayload?: ToolPayloadCapture;
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
  guildIds: DiscordGuildId[];
  /**
   * The asker, used for requester-scoped tools, spending and authorization.
   */
  requesterId: DiscordAccountId;
  /** Discord-originated dare drafts keep the invoking channel as metadata. */
  originChannelId: DiscordChannelId | null;
  /**
   * Which product surface this turn is answered on. It changes delivery and
   * how permissions are learned, never which tools exist; see
   * `explore/surface.ts`.
   */
  surface: ExploreSurface;
  abortSignal: AbortSignal;
  emit: (event: ExploreStreamEvent) => void | Promise<void>;
};
