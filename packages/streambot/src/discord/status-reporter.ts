import { shameMessage } from "@shepherdjerred/streambot/moderation/adult-block.ts";
import type { UserId } from "@shepherdjerred/streambot/types/ids.ts";

/** Minimal projection of the machine snapshot the reporter needs. */
export type StatusSnapshot = {
  readonly state: string;
  readonly currentTitle: string | null;
  readonly currentRequester: UserId | null;
  readonly blockedNonce: number;
  readonly blockedRequester: UserId | null;
};

/**
 * Turns machine transitions into world-readable announcements in the status channel: "now playing"
 * when a stream starts, and the cheeky shaming when an adult source is blocked. De-duped so a
 * re-rendered snapshot doesn't spam. Wire `handle` into `actor.subscribe(...)`.
 */
export class StatusReporter {
  private readonly announce: (message: string) => Promise<void>;
  private lastNowKey: string | null = null;
  private lastNonce: number;

  constructor(announce: (message: string) => Promise<void>, initialNonce = 0) {
    this.announce = announce;
    this.lastNonce = initialNonce;
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
    if (nowKey !== this.lastNowKey) {
      this.lastNowKey = nowKey;
      const who =
        snapshot.currentRequester === null
          ? ""
          : ` (requested by <@${snapshot.currentRequester}>)`;
      void this.announce(`▶️ Now playing **${nowKey}**${who}`);
    }
  }
}
