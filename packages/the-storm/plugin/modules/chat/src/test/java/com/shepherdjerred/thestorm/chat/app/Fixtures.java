package com.shepherdjerred.thestorm.chat.app;

import com.shepherdjerred.thestorm.chat.domain.ChannelKey;
import com.shepherdjerred.thestorm.chat.domain.ChatProfile;
import com.shepherdjerred.thestorm.chat.domain.FilterSettings;
import com.shepherdjerred.thestorm.chat.domain.Mute;
import com.shepherdjerred.thestorm.chat.domain.Speaker;
import java.time.Duration;
import java.time.Instant;
import java.time.InstantSource;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Shared test doubles for the chat app layer. */
final class Fixtures {

  static final UUID ALICE = UUID.fromString("00000000-0000-0000-0000-00000000000a");
  static final UUID BOB = UUID.fromString("00000000-0000-0000-0000-00000000000b");
  static final UUID CAROL = UUID.fromString("00000000-0000-0000-0000-00000000000c");
  static final Speaker ALICE_SPEAKS = new Speaker(ALICE, "Alice", false, false);
  static final Speaker STAFF_SPEAKS = new Speaker(CAROL, "Carol", true, false);

  static final ChatConfig CONFIG =
      new ChatConfig(
          "global",
          new FilterSettings(256, 3, 30),
          "Calm down",
          new ChannelFormats(
              "[G][<prefix><player>]: <message>",
              "[W][<prefix><player>]: <message>",
              "[S][<prefix><player>]: <message>",
              "[T][<prefix><player>]: <message>",
              "[N][<prefix><player>]: <message>"),
          "[<channel>] * <prefix><player> <message>",
          "[<from> -> <to>]: <message>",
          "[<source>][<author>]: <message>");

  private Fixtures() {}

  /** A clock tests move by hand. */
  static final class Clock implements InstantSource {

    private Instant now = Instant.parse("2017-06-01T12:00:00Z");

    @Override
    public Instant instant() {
      return now;
    }

    void advance(Duration duration) {
      now = now.plus(duration);
    }
  }

  /** A store that records writes and serves a fixed snapshot. */
  static final class RecordingStore implements ChatStore {

    final Map<UUID, ChatProfile> profiles = new HashMap<>();
    final Map<UUID, Mute> mutes = new HashMap<>();
    final List<String> writes = new ArrayList<>();
    ChatSnapshot snapshot = new ChatSnapshot(Map.of(), Map.of());

    @Override
    public CompletableFuture<ChatSnapshot> loadAll(Instant now, ChannelKey defaultFocus) {
      return CompletableFuture.completedFuture(snapshot);
    }

    @Override
    public void saveProfile(UUID player, ChatProfile profile) {
      profiles.put(player, profile);
      writes.add("profile " + player);
    }

    @Override
    public void saveMute(UUID player, Mute mute) {
      mutes.put(player, mute);
      writes.add("mute " + player);
    }

    @Override
    public void deleteMute(UUID player) {
      mutes.remove(player);
      writes.add("unmute " + player);
    }
  }
}
