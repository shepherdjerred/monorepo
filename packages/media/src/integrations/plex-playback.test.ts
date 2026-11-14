import { describe, expect, it } from "vitest";
import { PlexPlaybackClient } from "./plex-playback.ts";
import { IntegrationError } from "./http.ts";

const session = {
  ratingKey: "42",
  sessionKey: "7",
  title: "Pilot",
  type: "episode",
  grandparentTitle: "Series",
  duration: 3_600_000,
  viewOffset: 600_000,
  User: { id: 123 },
  Player: { machineIdentifier: "player", platform: "tvOS", state: "playing" },
  Session: { id: "actual-session-uuid" },
  Media: [{ videoDecision: "directplay", audioDecision: "directplay" }],
};
const config = {
  baseUrl: "https://plex.example",
  token: "test-only",
  clientIdentifier: "test",
};
describe("separate Plex playback reader", () => {
  it("retains actual session/account identities and direct-play mode", async () => {
    const client = new PlexPlaybackClient(config, async (url, init) => {
      expect(url.pathname).toBe("/status/sessions");
      expect(url.search).toBe("");
      expect(new Headers(init.headers).get("X-Plex-Token")).toBe("test-only");
      return Response.json({
        MediaContainer: { size: 1, Metadata: [session] },
      });
    });
    const sessions = await client.sessions();
    expect(sessions[0]).toMatchObject({
      sessionId: "actual-session-uuid",
      serverAccountId: "123",
      decision: "direct_play",
      seriesTitle: "Series",
    });
  });
  it("distinguishes copy/transcode and rejects incomplete or unattributed observations", async () => {
    const copy = new PlexPlaybackClient(config, async () =>
      Response.json({
        MediaContainer: {
          size: 1,
          Metadata: [
            { ...session, TranscodeSession: { audioDecision: "copy" } },
          ],
        },
      }),
    );
    const sessions = await copy.sessions();
    expect(sessions[0]?.decision).toBe("direct_stream");
    for (const container of [
      { size: 2, Metadata: [session] },
      { size: 1, Metadata: [{ ...session, User: undefined }] },
    ]) {
      await expect(
        new PlexPlaybackClient(config, async () =>
          Response.json({ MediaContainer: container }),
        ).sessions(),
      ).rejects.toBeInstanceOf(IntegrationError);
    }
  });
});
