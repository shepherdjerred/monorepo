package com.shepherdjerred.thestorm.agent.app;

import com.shepherdjerred.thestorm.chat.app.ChannelFormats;
import com.shepherdjerred.thestorm.chat.app.ChatConfig;
import com.shepherdjerred.thestorm.chat.app.ChatExtensions;
import com.shepherdjerred.thestorm.chat.app.ChatService;
import com.shepherdjerred.thestorm.chat.app.ChatSnapshot;
import com.shepherdjerred.thestorm.chat.app.ChatStore;
import com.shepherdjerred.thestorm.chat.domain.ChannelKey;
import com.shepherdjerred.thestorm.chat.domain.ChatProfile;
import com.shepherdjerred.thestorm.chat.domain.FilterSettings;
import com.shepherdjerred.thestorm.chat.domain.Mute;
import com.shepherdjerred.thestorm.essentials.app.store.ModerationLogStore;
import com.shepherdjerred.thestorm.essentials.domain.moderation.AuditEntry;
import java.time.Duration;
import java.time.Instant;
import java.time.InstantSource;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Shared fakes for the agent flow tests. */
final class AgentFixtures {

  static final UUID ALICE = UUID.fromString("00000000-0000-0000-0000-00000000000a");
  static final Instant NOW = Instant.parse("2017-06-01T12:00:00Z");

  private AgentFixtures() {}

  /** A clock tests move by hand. */
  static final class Clock implements InstantSource {

    private Instant now = NOW;

    @Override
    public Instant instant() {
      return now;
    }

    void advance(Duration duration) {
      now = now.plus(duration);
    }
  }

  /** A chat store that keeps mutes in memory. */
  static final class MemoryChatStore implements ChatStore {

    final Map<UUID, Mute> mutes = new HashMap<>();

    @Override
    public CompletableFuture<ChatSnapshot> loadAll(Instant now, ChannelKey defaultFocus) {
      return CompletableFuture.completedFuture(new ChatSnapshot(Map.of(), Map.of()));
    }

    @Override
    public void saveProfile(UUID player, ChatProfile profile) {}

    @Override
    public void saveMute(UUID player, Mute mute) {
      mutes.put(player, mute);
    }

    @Override
    public void deleteMute(UUID player) {
      mutes.remove(player);
    }
  }

  /** A real chat service over the memory store. */
  static ChatService chatService(MemoryChatStore store, Clock clock) {
    return new ChatService(
        new ChatConfig(
            "global",
            new FilterSettings(256, 3, 30),
            "Calm down",
            new ChannelFormats(
                "[G][<prefix><player>]: <message>",
                "[W][<prefix><player>]: <message>",
                "[S][<prefix><player>]: <message>",
                "[T][<prefix><player>]: <message>"),
            "[<channel>] * <prefix><player> <message>",
            "[<from> -> <to>]: <message>",
            "[<source>][<author>]: <message>"),
        store,
        clock,
        new ChatExtensions());
  }

  /** A moderation log that keeps entries in memory. */
  static final class MemoryModLog implements ModerationLogStore {

    final List<AuditEntry> entries = new ArrayList<>();

    @Override
    public CompletableFuture<Void> append(AuditEntry entry) {
      entries.add(entry);
      return CompletableFuture.completedFuture(null);
    }

    @Override
    public CompletableFuture<List<AuditEntry>> all() {
      return CompletableFuture.completedFuture(List.copyOf(entries));
    }

    @Override
    public CompletableFuture<List<AuditEntry>> history(UUID target, int limit) {
      var mine =
          entries.reversed().stream()
              .filter(entry -> entry.target().equals(target))
              .limit(limit)
              .toList();
      return CompletableFuture.completedFuture(mine);
    }
  }

  /** Player contact that records instead of reaching the game. */
  static final class RecordingContact implements PlayerContact {

    final List<String> tells = new ArrayList<>();
    final List<String> kicks = new ArrayList<>();

    @Override
    public CompletableFuture<Boolean> tell(UUID player, String text) {
      tells.add(player + ": " + text);
      return CompletableFuture.completedFuture(true);
    }

    @Override
    public CompletableFuture<Boolean> kick(UUID player, String reason) {
      kicks.add(player + ": " + reason);
      return CompletableFuture.completedFuture(true);
    }
  }

  /** A config with the standard bars and limits, in {@code mode} with {@code ladders}. */
  static AgentConfig config(String mode, List<AgentConfig.LadderFile> ladders) {
    return config(mode, ladders, 10);
  }

  /** A config with the standard bars and limits, sampling {@code reviewSamplePercent}. */
  static AgentConfig config(
      String mode, List<AgentConfig.LadderFile> ladders, int reviewSamplePercent) {
    return new AgentConfig(
        mode,
        0.8,
        0.7,
        0.95,
        new AgentConfig.PrefilterFile(5, 10, 400, 3, 20, 70),
        ladders,
        reviewSamplePercent,
        new AgentConfig.BrainFile("http://brain:3000", "STORM_BRAIN_BEARER_TOKEN", 65_000),
        new AgentConfig.SweepFile(15, 10, 60, 240),
        "test",
        new AgentConfig.FaqFile(false, 168, List.of()),
        new AgentConfig.OnboardingFile(false, List.of()));
  }

  /** A ladder for {@code offense} with a seven-day window. */
  static AgentConfig.LadderFile ladder(String offense, AgentConfig.StepFile... steps) {
    return new AgentConfig.LadderFile(offense, "7d", List.of(steps));
  }

  /** A catalog entry answering {@code keyword} with {@code reply} and no link. */
  static AgentConfig.FaqEntryFile faqEntry(String id, String keyword, String reply) {
    return new AgentConfig.FaqEntryFile(id, List.of(keyword), reply, "");
  }

  /** A config in {@code mode} with an enabled FAQ catalog of {@code entries}. */
  static AgentConfig faqConfig(String mode, List<AgentConfig.FaqEntryFile> entries) {
    return new AgentConfig(
        mode,
        0.8,
        0.7,
        0.95,
        new AgentConfig.PrefilterFile(5, 10, 400, 3, 20, 70),
        List.of(),
        0,
        new AgentConfig.BrainFile("http://brain:3000", "STORM_BRAIN_BEARER_TOKEN", 65_000),
        new AgentConfig.SweepFile(15, 10, 60, 240),
        "test",
        new AgentConfig.FaqFile(true, 168, entries),
        new AgentConfig.OnboardingFile(false, List.of()));
  }
}
