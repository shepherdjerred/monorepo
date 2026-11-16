package com.shepherdjerred.thestorm.safety.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.analytics.ProductAnalytics;
import com.shepherdjerred.thestorm.core.compute.DirectComputePool;
import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.expansion.ManagedGameplay;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.Services;
import com.shepherdjerred.thestorm.core.safety.ApprovedChatEvent;
import com.shepherdjerred.thestorm.core.safety.ContentPublication;
import com.shepherdjerred.thestorm.core.safety.ContentReview;
import com.shepherdjerred.thestorm.core.schedule.PaperScheduler;
import com.shepherdjerred.thestorm.safety.adapter.db.JooqEvidenceStore;
import com.shepherdjerred.thestorm.safety.app.SafetyConfig;
import com.shepherdjerred.thestorm.safety.app.SafetyService;
import io.papermc.paper.chat.ChatRenderer;
import io.papermc.paper.event.player.AsyncChatEvent;
import java.nio.file.Path;
import java.time.Instant;
import java.time.InstantSource;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.random.RandomGenerator;
import net.kyori.adventure.audience.Audience;
import net.kyori.adventure.chat.SignedMessage;
import net.kyori.adventure.identity.Identity;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerCommandPreprocessEvent;
import org.bukkit.plugin.Plugin;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

final class TextGateTest {
  private static final Instant NOW = Instant.parse("2026-11-15T12:00:00Z");
  private static final SafetyConfig CONFIG =
      new SafetyConfig("http://localhost:3000", "TEST", 1000, 30, 32);

  @TempDir Path directory;

  private ServerMock server;
  private Plugin plugin;
  private StormDatabase database;
  private JooqEvidenceStore store;
  private final AtomicBoolean asyncFlag = new AtomicBoolean(true);
  private final AtomicBoolean safetyFlag = new AtomicBoolean(true);
  private final AtomicInteger classifierCalls = new AtomicInteger();
  private final AtomicReference<CompletableFuture<ContentReview>> classifierResponse =
      new AtomicReference<>();
  private final List<SignedMessage> deleted = new ArrayList<>();
  private final List<UUID> retracted = new ArrayList<>();
  private final List<Integer> penalties = new ArrayList<>();
  private SafetyService safety;

  @BeforeEach
  void setUp() {
    server = MockBukkit.mock();
    server.addSimpleWorld("world");
    plugin = MockBukkit.createMockPlugin("TheStorm");
    database = StormDatabase.open(directory.resolve("safety.db"));
    database.migrate("safety", getClass().getClassLoader());
    store = new JooqEvidenceStore(database);
    classifierResponse.set(CompletableFuture.completedFuture(allowReview()));

    var flags =
        new ManagedGameplay(
            (key, actor) ->
                CompletableFuture.completedFuture(
                    ManagedGameplay.ASYNC_CHAT_MODERATION.equals(key)
                        ? asyncFlag.get()
                        : safetyFlag.get()),
            () -> {});
    var context =
        new ModuleContext(
            plugin,
            plugin.getLifecycleManager(),
            new PaperScheduler(plugin),
            new DirectComputePool(),
            database,
            new Services(),
            directory,
            InstantSource.fixed(NOW),
            RandomGenerator.getDefault(),
            plugin.getComponentLogger(),
            ProductAnalytics.disabled());
    safety =
        new SafetyService(
            store,
            (submission, window, surrounding) -> {
              classifierCalls.incrementAndGet();
              return classifierResponse.get();
            },
            new SafetyService.Policy(
                InstantSource.fixed(NOW),
                CONFIG,
                actor -> CompletableFuture.completedFuture(safetyFlag.get())));
    safety.audiences((actor, text) -> "global");
    safety.penalties(request -> {
      penalties.add(request.review().muteSeconds());
      return CompletableFuture.completedFuture(null);
    });
    safety.retractions(retracted::add);

    server
        .getPluginManager()
        .registerEvents(new TextGate(context, safety, flags, deleted::add), plugin);
  }

  @AfterEach
  void tearDown() {
    MockBukkit.unmock();
    database.close();
  }

  private static ContentReview allowReview() {
    return new ContentReview("allow", "none", 1, "Allowed.", "fixture", 0, 0, Map.of(), true);
  }

  private static ContentReview blockReview(String category, String reason, double confidence) {
    return new ContentReview(
        "block", category, confidence, reason, "fixture", 0, 0, Map.of(), true);
  }

  private static SignedMessage signedMessage(UUID sender, String text, boolean deletable) {
    return new SignedMessage() {
      @Override
      public Instant timestamp() {
        return NOW;
      }

      @Override
      public long salt() {
        return 1L;
      }

      @Override
      public @Nullable Signature signature() {
        return deletable ? SignedMessage.signature(new byte[256]) : null;
      }

      @Override
      public @Nullable Component unsignedContent() {
        return null;
      }

      @Override
      public String message() {
        return text;
      }

      @Override
      public boolean canDelete() {
        return deletable;
      }

      @Override
      public Identity identity() {
        return Identity.identity(sender);
      }
    };
  }

  private AsyncChatEvent fireChat(PlayerMock player, String text, boolean deletable) {
    var message = Component.text(text);
    var viewers = new HashSet<Audience>();
    var event =
        new AsyncChatEvent(
            true,
            player,
            viewers,
            ChatRenderer.defaultRenderer(),
            message,
            message,
            signedMessage(player.getUniqueId(), text, deletable));
    CompletableFuture.runAsync(() -> server.getPluginManager().callEvent(event)).join();
    return event;
  }

  private void flush() {
    for (var round = 0; round < 3; round++) {
      server.getScheduler().performTicks(1);
      safety.awaitPending().join();
      database.read(dsl -> null).join();
    }
    server.getScheduler().performTicks(1);
  }

  private static List<String> drainedMessages(PlayerMock player) {
    var messages = new ArrayList<String>();
    Component next;
    while ((next = player.nextComponentMessage()) != null) {
      messages.add(PlainTextComponentSerializer.plainText().serialize(next));
    }
    return messages;
  }

  @Test
  void cleanChatAndMildSwearingSkipPrePublicationHoldAndPreservePublicationContext() {
    var alice = server.addPlayer("Alice");
    var pendingClassifier = new CompletableFuture<ContentReview>();
    classifierResponse.set(pendingClassifier);

    var capturedContext =
        new AtomicReference<Optional<ContentPublication.Context>>(Optional.empty());
    server
        .getPluginManager()
        .registerEvent(
            AsyncChatEvent.class,
            new Listener() {},
            EventPriority.HIGH,
            (listener, raw) ->
                capturedContext.set(ContentPublication.eventContext((AsyncChatEvent) raw)),
            plugin,
            true);

    var event = fireChat(alice, "wtf nice clutch lmao", true);

    assertThat(event.isCancelled()).isFalse();
    assertThat(capturedContext.get()).isPresent();
    assertThat(capturedContext.get().orElseThrow().screened()).isTrue();
    assertThat(capturedContext.get().orElseThrow().submissionId()).isPresent();
    assertThat(ContentPublication.eventContext(event)).isEmpty();
    assertThat(deleted).isEmpty();
    assertThat(retracted).isEmpty();

    pendingClassifier.complete(allowReview());
    flush();

    assertThat(classifierCalls.get()).isEqualTo(1);
    assertThat(deleted).isEmpty();
    assertThat(retracted).isEmpty();
    assertThat(drainedMessages(alice)).isEmpty();
  }

  @Test
  void stageOneBlocksEgregiousChatSynchronouslyWithoutCallingClassifier() {
    var alice = server.addPlayer("Alice");

    var event = fireChat(alice, "go k y s loser", true);
    flush();

    assertThat(event.isCancelled()).isTrue();
    assertThat(classifierCalls.get()).isZero();
    assertThat(penalties).containsExactly(600);
    assertThat(drainedMessages(alice))
        .singleElement()
        .asString()
        .contains("This was not published (harassment).")
        .contains("Reference ");
  }

  @Test
  void stageTwoAsyncBlockDeletesSignedMessageRetractsDiscordAndNotifiesSender() {
    var alice = server.addPlayer("Alice");
    var pendingClassifier = new CompletableFuture<ContentReview>();
    classifierResponse.set(pendingClassifier);

    var event = fireChat(alice, "subtle targeted harassment", true);
    assertThat(event.isCancelled()).isFalse();
    assertThat(deleted).isEmpty();

    pendingClassifier.complete(blockReview("harassment", "Targeted harassment.", 0.96));
    flush();

    assertThat(deleted).containsExactly(event.signedMessage());
    assertThat(retracted).hasSize(1);
    var submissionId = retracted.getFirst();
    assertThat(drainedMessages(alice))
        .singleElement()
        .asString()
        .isEqualTo(
            "Your recent message was removed (harassment). Targeted harassment. Reference %s",
            submissionId);
  }

  @Test
  void stageTwoUnsignedMessageRetractsDiscordAndRecordsUnsignedOutcome() {
    var alice = server.addPlayer("Alice");
    classifierResponse.set(
        CompletableFuture.completedFuture(blockReview("advertising", "Cold promotion.", 0.99)));

    var event = fireChat(alice, "subtle external promo", false);
    assertThat(event.isCancelled()).isFalse();
    flush();

    assertThat(deleted).isEmpty();
    assertThat(retracted).hasSize(1);
    assertThat(drainedMessages(alice))
        .singleElement()
        .asString()
        .contains("Your recent message was removed (advertising). Cold promotion.");
    assertThat(
            store
                .advertisingWarnings(alice.getUniqueId(), NOW.minusSeconds(1), NOW.plusSeconds(1))
                .join())
        .isEqualTo(1);
  }

  @Test
  void chatCancelledByChatListenerDoesNotCallClassifier() {
    var alice = server.addPlayer("Alice");
    server
        .getPluginManager()
        .registerEvent(
            AsyncChatEvent.class,
            new Listener() {},
            EventPriority.HIGH,
            (listener, raw) -> ((AsyncChatEvent) raw).setCancelled(true),
            plugin,
            true);

    var event = fireChat(alice, "hello while muted", true);
    flush();

    assertThat(event.isCancelled()).isTrue();
    assertThat(classifierCalls.get()).isZero();
    assertThat(store.search("Alice", "hello while muted", 10).join()).contains("hello while muted");
  }

  @Test
  void liveChatCommandsExecuteImmediatelyWhilePersistentCommandsRemainPreGated() {
    var alice = server.addPlayer("Alice");
    var pendingClassifier = new CompletableFuture<ContentReview>();
    classifierResponse.set(pendingClassifier);

    var liveCommand = new PlayerCommandPreprocessEvent(alice, "/g hello everyone");
    server.getPluginManager().callEvent(liveCommand);
    assertThat(liveCommand.isCancelled()).isFalse();

    pendingClassifier.complete(blockReview("harassment", "Disguised abuse.", 0.95));
    flush();
    assertThat(retracted).hasSize(1);
    assertThat(drainedMessages(alice))
        .singleElement()
        .asString()
        .contains("Your recent message was removed (harassment). Disguised abuse.");

    for (var persistent :
        List.of(
            "/nick CoolName",
            "/mail send Bob hello there",
            "/town create Riverdale",
            "/ticket open someone griefed my house")) {
      var gated = new PlayerCommandPreprocessEvent(alice, persistent);
      server.getPluginManager().callEvent(gated);
      assertThat(gated.isCancelled())
          .as("expected persistent surface to remain pre-gated: %s", persistent)
          .isTrue();
    }
  }

  @Test
  void disablingAsyncChatModerationRevertsToLegacyPrePublicationHold() {
    asyncFlag.set(false);
    var alice = server.addPlayer("Alice");
    var approvedEvents = new ArrayList<ApprovedChatEvent>();
    server
        .getPluginManager()
        .registerEvent(
            ApprovedChatEvent.class,
            new Listener() {},
            EventPriority.NORMAL,
            (listener, raw) -> {
              var approved = (ApprovedChatEvent) raw;
              approved.markDelivered();
              approvedEvents.add(approved);
            },
            plugin,
            false);

    var pendingClassifier = new CompletableFuture<ContentReview>();
    classifierResponse.set(pendingClassifier);

    var event = fireChat(alice, "held until classified", true);
    assertThat(event.isCancelled()).isTrue();
    server.getScheduler().performTicks(2);
    assertThat(approvedEvents).isEmpty();

    pendingClassifier.complete(allowReview());
    flush();
    assertThat(approvedEvents).hasSize(1);
  }
}
