import { withMode } from "@shepherdjerred/streambot/sources/source.ts";
import type {
  CommandHandlerDeps,
  CommandInteraction,
} from "@shepherdjerred/streambot/discord/command-types.ts";
import { PlaybackCommandService } from "@shepherdjerred/streambot/commands/playback-command-service.ts";
import { PlaybackCommandBoundaryError } from "@shepherdjerred/streambot/commands/playback-command-errors.ts";
import { inferMediaIntent } from "@shepherdjerred/streambot/discovery/media-intent.ts";
import type {
  DiscoveryScope,
  MediaCandidate,
} from "@shepherdjerred/streambot/discovery/candidate.ts";
import type { QueueItemView } from "@shepherdjerred/streambot/machine/view.ts";
import type { RecordMedia } from "@shepherdjerred/streambot/history/media-history.ts";

type CommandReply = { readonly message: string };

/** Advanced playback, history, and personal command groups. */
export class MediaCommandHandler {
  private readonly playback: PlaybackCommandService;

  constructor(private readonly deps: CommandHandlerDeps) {
    this.playback = new PlaybackCommandService(deps);
  }

  async runPlayback(
    sub: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!(await this.assistantEnabled(interaction))) {
      await interaction.reply(
        "The Streambot assistant beta is not enabled here.",
      );
      return;
    }
    const result = await this.runBoundary(async () => {
      switch (sub) {
        case "pause":
          return this.playback.pause(interaction.userId);
        case "resume":
          return this.playback.resume(interaction.userId);
        case "restart":
          return this.playback.restart(interaction.userId);
        case "leave":
          return this.playback.leave();
        case "previous":
          return await this.playback.previous(interaction.userId);
        default:
          throw new PlaybackCommandBoundaryError("Unknown playback command.");
      }
    });
    await interaction.reply(result.message);
  }

  async runHistory(
    sub: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    const scope = this.scope(interaction);
    if (
      scope === null ||
      this.deps.history === undefined ||
      !(await this.historyEnabled(scope))
    ) {
      await interaction.reply("Playback history is not available.");
      return;
    }
    const visibility =
      interaction.getString("scope") === "server" ? "server" : "mine";
    const entries = this.deps.history.list(scope, visibility);
    if (sub === "list") {
      await interaction.reply(
        candidateList(entries, "No playback history yet."),
      );
      return;
    }
    if (sub === "replay") {
      const candidate = entries[interaction.getIntegerRequired("index") - 1];
      if (candidate === undefined) {
        await interaction.reply("That history entry does not exist.");
        return;
      }
      await this.dispatchCandidate(candidate, interaction, "queue");
      await interaction.reply(`Queued **${candidate.title}** from history.`);
      return;
    }
    await interaction.reply("Unknown history command.");
  }

  async runPersonal(
    sub: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    const history = this.deps.history;
    const scope = this.scope(interaction);
    if (
      history === undefined ||
      scope === null ||
      !(await this.historyEnabled(scope))
    ) {
      await interaction.reply("Personal media history is not available.");
      return;
    }
    switch (sub) {
      case "favorite-add":
        await this.addFavorite(interaction);
        return;
      case "favorite-remove":
        await this.removeFavorite(interaction);
        return;
      case "favorites":
        await interaction.reply(
          candidateList(
            history.favorites(interaction.userId),
            "No favorites yet.",
          ),
        );
        return;
      case "save-queue":
        await this.saveQueue(interaction);
        return;
      case "saved-queues": {
        const names = history.savedQueueNames(interaction.userId);
        await interaction.reply(
          names.length === 0 ? "No saved queues yet." : names.join("\n"),
        );
        return;
      }
      case "load-queue":
        await this.loadQueue(interaction);
        return;
      case "delete-queue":
        history.deleteSavedQueue(
          interaction.userId,
          interaction.getStringRequired("name"),
        );
        await interaction.reply("Deleted the saved queue.");
        return;
      case "usual":
        await this.queueUsual(interaction, scope);
        return;
      case "continue":
        await this.continueSeries(interaction, scope);
        return;
      default:
        await interaction.reply("Unknown personal command.");
    }
  }

  private async addFavorite(interaction: CommandInteraction): Promise<void> {
    const current = this.deps.view().current;
    if (current?.source === undefined) {
      await interaction.reply("Nothing is playing.");
      return;
    }
    this.deps.history?.addFavorite(
      interaction.userId,
      this.recordMedia(current),
    );
    await interaction.reply(`Favorited **${current.title}**.`);
  }

  private async removeFavorite(interaction: CommandInteraction): Promise<void> {
    const favorites = this.deps.history?.favorites(interaction.userId) ?? [];
    const selected = favorites[interaction.getIntegerRequired("index") - 1];
    if (selected === undefined) {
      await interaction.reply("That favorite does not exist.");
      return;
    }
    this.deps.history?.removeFavorite(interaction.userId, selected.token);
    await interaction.reply(`Removed **${selected.title}** from favorites.`);
  }

  private async saveQueue(interaction: CommandInteraction): Promise<void> {
    const items = this.deps
      .view()
      .queue.flatMap((item) =>
        item.source === undefined ? [] : [this.recordMedia(item)],
      );
    this.deps.history?.saveQueue(
      interaction.userId,
      interaction.getStringRequired("name"),
      items,
    );
    await interaction.reply(`Saved ${String(items.length)} queued item(s).`);
  }

  private async loadQueue(interaction: CommandInteraction): Promise<void> {
    const name = interaction.getStringRequired("name");
    const items = this.deps.history?.savedQueue(interaction.userId, name) ?? [];
    for (const item of items) {
      await this.dispatchCandidate(item, interaction, "queue");
    }
    await interaction.reply(
      items.length === 0
        ? `No saved queue named **${name}**.`
        : `Loaded ${String(items.length)} item(s) from **${name}**.`,
    );
  }

  private async queueUsual(
    interaction: CommandInteraction,
    scope: DiscoveryScope,
  ): Promise<void> {
    const candidate = this.deps.history?.usual(scope) ?? null;
    if (candidate === null) {
      await interaction.reply("You do not have enough playback history yet.");
      return;
    }
    await this.dispatchCandidate(candidate, interaction, "queue");
    await interaction.reply(`Queued your usual: **${candidate.title}**.`);
  }

  private async continueSeries(
    interaction: CommandInteraction,
    scope: DiscoveryScope,
  ): Promise<void> {
    const recent = this.deps.history?.list(scope, "mine", 10) ?? [];
    for (const item of recent) {
      const query = nextEpisodeQuery(item.title);
      if (query === null) continue;
      const match = this.deps
        .library()
        .find((entry) => entry.title.includes(query));
      if (match === undefined) continue;
      await this.dispatchCandidate(
        {
          token: crypto.randomUUID(),
          provider: "local",
          title: match.title,
          source: { kind: "file", path: match.path, title: match.title },
          score: 100,
          reason: match.relativePath,
        },
        interaction,
        "queue",
      );
      await interaction.reply(`Queued next episode: **${match.title}**.`);
      return;
    }
    await interaction.reply(
      "I could not find a next local episode in your recent history.",
    );
  }

  private async dispatchCandidate(
    candidate: MediaCandidate,
    interaction: CommandInteraction,
    placement: "queue" | "now",
  ): Promise<void> {
    const scope = this.requireScope(interaction);
    // History replays, favorites, saved queues, "my usual" and continue-series all arrive here
    // without passing through `PlaybackCommandService.play`, so the rollout gate has to be applied
    // on this path too. Stored sources are deliberately kept mode-less, so with the flag off they
    // would otherwise auto-classify and take the voice transport the flag is meant to disable.
    const mode = await this.playback.resolveMediaMode(
      interaction.userId,
      candidate.source.mode,
    );
    const requestId = this.deps.history?.recordQueueRequest({
      scope,
      rawQuery: candidate.title,
      intent: inferMediaIntent({ query: candidate.title, placement }),
      media: candidateMedia(candidate),
    });
    this.deps.dispatch({
      type: placement === "now" ? "PLAY_NOW" : "ADD",
      source: withMode(candidate.source, mode),
      requesterId: interaction.userId,
      ...(requestId === undefined ? {} : { requestId }),
    });
  }

  private recordMedia(item: QueueItemView): RecordMedia {
    if (item.source === undefined) {
      throw new PlaybackCommandBoundaryError(
        "That media source is unavailable.",
      );
    }
    return {
      title: item.title,
      provider: item.source.kind === "file" ? "local" : "youtube",
      source: item.source,
      canonicalUrl: item.provenance?.canonicalUrl,
      channel: item.provenance?.channel,
      thumbnailUrl: item.provenance?.thumbnailUrl,
      durationSeconds: item.durationSeconds ?? undefined,
    };
  }

  private scope(interaction: CommandInteraction): DiscoveryScope | null {
    return this.deps.guildId === undefined || this.deps.channelId === undefined
      ? null
      : {
          guildId: this.deps.guildId,
          channelId: this.deps.channelId,
          userId: interaction.userId,
        };
  }

  private requireScope(interaction: CommandInteraction): DiscoveryScope {
    const scope = this.scope(interaction);
    if (scope === null) {
      throw new PlaybackCommandBoundaryError(
        "Playback history is not available here.",
      );
    }
    return scope;
  }

  private async assistantEnabled(
    interaction: CommandInteraction,
  ): Promise<boolean> {
    const scope = this.scope(interaction);
    return scope !== null && this.deps.featureGate !== undefined
      ? await this.deps.featureGate.assistantV2(scope)
      : true;
  }

  private async historyEnabled(scope: DiscoveryScope): Promise<boolean> {
    return this.deps.featureGate === undefined
      ? true
      : await this.deps.featureGate.history(scope);
  }

  private async runBoundary(
    operation: () => Promise<CommandReply>,
  ): Promise<CommandReply> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof PlaybackCommandBoundaryError) {
        return { message: error.message };
      }
      throw error;
    }
  }
}

function candidateList(
  candidates: readonly MediaCandidate[],
  empty: string,
): string {
  return candidates.length === 0
    ? empty
    : candidates
        .map(
          (item, index) =>
            `${String(index + 1)}. **${item.title}** — ${item.reason}`,
        )
        .join("\n");
}

function candidateMedia(candidate: MediaCandidate): RecordMedia {
  return {
    title: candidate.title,
    provider: candidate.source.kind === "file" ? "local" : "youtube",
    source: candidate.source,
    canonicalUrl: candidate.canonicalUrl,
    channel: candidate.channel,
    thumbnailUrl: candidate.thumbnailUrl,
    durationSeconds: candidate.durationSeconds,
  };
}

function nextEpisodeQuery(title: string): string | null {
  const marker = /\bS(?<season>\d{1,2})E(?<episode>\d{1,3})\b/iu.exec(title);
  const season = marker?.groups?.["season"];
  const episode = marker?.groups?.["episode"];
  if (marker === null || season === undefined || episode === undefined) {
    return null;
  }
  const series = title
    .slice(0, marker.index)
    .replace(/[\s-]+$/u, "")
    .trim();
  if (series.length === 0) return null;
  const next = Number(episode) + 1;
  return `${series} S${season.padStart(2, "0")}E${String(next).padStart(2, "0")}`;
}
