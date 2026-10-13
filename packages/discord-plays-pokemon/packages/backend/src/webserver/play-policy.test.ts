import { expect, test } from "vitest";
import { createPlayPolicy, humanPlayersInVoice } from "./play-policy.ts";

const USER = {
  discordId: "42",
  username: "trainer",
  name: "May",
  avatarUrl: null,
};

test("own and peer streaming accounts cannot satisfy the human-player minimum", () => {
  const member = {
    user: { bot: false, username: "trainer", avatar: null },
    displayName: "May",
  };
  const players = humanPlayersInVoice(
    [
      { id: USER.discordId, channelId: "voice", member },
      { id: "own-streamer", channelId: "voice", member },
      { id: "peer-streamer", channelId: "voice", member },
      {
        id: "bot",
        channelId: "voice",
        member: { ...member, user: { ...member.user, bot: true } },
      },
      { id: "elsewhere", channelId: "other", member },
    ],
    "voice",
    new Set(["own-streamer", "peer-streamer"]),
  );
  expect(players.map((player) => player.discordId)).toEqual([USER.discordId]);
  const policy = createPlayPolicy({
    channel: () => ({ guildId: "guild", voiceChannelId: "voice" }),
    voice: {
      isInChannel: () => true,
      channelName: () => "Pokémon",
      displayName: () => "May",
    },
    players: () => players,
    minimumInChannel: 2,
  });
  expect(policy.blockerFor(USER)).toBe("too-few-players");
  expect(policy.canWatch(USER)).toBe(true);
});

test("play policy follows the current session, voice membership, and human count", () => {
  let active = false;
  let present = false;
  let players = [USER];
  const policy = createPlayPolicy({
    channel: () => (active ? { guildId: "1", voiceChannelId: "2" } : undefined),
    voice: {
      isInChannel: (_channel, id) => present && id === USER.discordId,
      channelName: () => "Pokémon",
      displayName: () => "May",
    },
    players: () => players,
    minimumInChannel: 2,
  });
  expect(policy.blockerFor(USER)).toBe("no-session");
  expect(policy.canWatch(USER)).toBe(false);
  active = true;
  expect(policy.blockerFor(undefined)).toBe("signed-out");
  expect(policy.blockerFor(USER)).toBe("not-in-voice");
  present = true;
  expect(policy.blockerFor(USER)).toBe("too-few-players");
  expect(policy.canWatch(USER)).toBe(true);
  players = [USER, { ...USER, discordId: "43" }];
  expect(policy.blockerFor(USER)).toBeNull();
  present = false;
  expect(policy.blockerFor(USER)).toBe("not-in-voice");
  expect(policy.canWatch(USER)).toBe(false);
});
