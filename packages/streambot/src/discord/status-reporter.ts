import { shameMessage } from "@shepherdjerred/streambot/moderation/adult-block.ts";
import type { Source } from "@shepherdjerred/streambot/sources/source.ts";
import { parseTitleYear } from "@shepherdjerred/streambot/sources/normalize.ts";
import type { PosterFetcher } from "@shepherdjerred/streambot/metadata/tmdb.ts";
import type { UserId } from "@shepherdjerred/streambot/types/ids.ts";

/**
 * A world-readable announcement: either plain text, or text plus an embed (used to attach a movie/TV
 * poster to the now-playing line). Kept discord.js-free here; `command-bot.ts` renders the embed.
 */
export type Announcement =
  | string
  | {
      readonly content: string;
      readonly embed?: { readonly title?: string; readonly imageUrl?: string };
    };

/** Minimal projection of the machine snapshot the reporter needs. */
export type StatusSnapshot = {
  readonly state: string;
  readonly currentTitle: string | null;
  readonly currentRequester: UserId | null;
  /** Kind of the currently-playing source — posters are only fetched for local files. */
  readonly currentKind: Source["kind"] | null;
  readonly blockedNonce: number;
  readonly blockedRequester: UserId | null;
};

export type StatusReporterOptions = {
  readonly initialNonce?: number;
  /** Optional poster lookup; when set, local-file now-playing lines get a poster embed. */
  readonly fetchPoster?: PosterFetcher;
};

/**
 * Turns machine transitions into world-readable announcements in the status channel: "now playing"
 * when a stream starts (with a movie/TV poster for local files when a poster fetcher is configured),
 * and the cheeky shaming when an adult source is blocked. De-duped so a re-rendered snapshot doesn't
 * spam. Wire `handle` into `actor.subscribe(...)`.
 */
export class StatusReporter {
  private readonly announce: (message: Announcement) => Promise<void>;
  private readonly fetchPoster: PosterFetcher | undefined;
  private lastNowKey: string | null = null;
  private lastNonce: number;

  constructor(
    announce: (message: Announcement) => Promise<void>,
    options: StatusReporterOptions = {},
  ) {
    this.announce = announce;
    this.fetchPoster = options.fetchPoster;
    this.lastNonce = options.initialNonce ?? 0;
  }

  handle(snapshot: StatusSnapshot): void {
    if (snapshot.blockedNonce !== this.lastNonce) {
      this.lastNonce = snapshot.blockedNonce;
      if (snapshot.blockedRequester !== null) {
        void this.announce(shameMessage(snapshot.blockedRequester));
      }
    }

    const nowKey =
      snapshot.state === "streaming" && snapshot.currentTitle !== null
        ? snapshot.currentTitle
        : null;
    if (nowKey === null) {
      // Reset between songs so a looped/repeated track re-announces when it starts again.
      this.lastNowKey = null;
      return;
    }
    if (nowKey === this.lastNowKey) {
      return;
    }
    // Set the dedup key before the (async) poster fetch so a re-rendered snapshot can't double-post.
    this.lastNowKey = nowKey;

    const who =
      snapshot.currentRequester === null
        ? ""
        : ` (requested by <@${snapshot.currentRequester}>)`;
    const content = `▶️ Now playing **${nowKey}**${who}`;

    if (snapshot.currentKind === "file" && this.fetchPoster !== undefined) {
      const fetchPoster = this.fetchPoster;
      void (async () => {
        const { title, year } = parseTitleYear(nowKey);
        const poster = await fetchPoster(title, year);
        await this.announce(
          poster === null
            ? content
            : { content, embed: { title: nowKey, imageUrl: poster.posterUrl } },
        );
      })();
      return;
    }

    void this.announce(content);
  }
}
