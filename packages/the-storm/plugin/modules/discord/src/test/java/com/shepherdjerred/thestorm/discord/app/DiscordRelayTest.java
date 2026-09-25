package com.shepherdjerred.thestorm.discord.app;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.chat.app.ChatAuthor;
import com.shepherdjerred.thestorm.chat.app.ChatLine;
import com.shepherdjerred.thestorm.chat.app.GlobalChat;
import com.shepherdjerred.thestorm.chat.app.Subscription;
import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.discord.domain.InboundMessage;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Executor;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;

final class DiscordRelayTest {

  static final DiscordConfig CONFIG =
      new DiscordConfig(
          "DISCORD_BOT_TOKEN",
          "DISCORD_CHANNEL_ID",
          "Awake",
          "D",
          20,
          new DiscordMessages(
              "**{player}**: {message}",
              "**{player}** joined",
              "**{player}** left",
              "{message}",
              "**{player}** got **{advancement}**",
              "The Storm has woken up",
              "The Storm sleeps. Join ts-mc.net to wake it.",
              "Online ({count}): {players}",
              "Nobody is online."));

  private static final String ZWSP = String.valueOf((char) 0x200B);

  private final List<String> posts = new ArrayList<>();
  private final List<String> relayed = new ArrayList<>();
  private final List<Runnable> mainThread = new ArrayList<>();
  private final List<String> online = new ArrayList<>();

  private final GlobalChat chat =
      new GlobalChat() {
        @Override
        public Subscription subscribe(Consumer<ChatLine> listener) {
          return () -> {};
        }

        @Override
        public void broadcastExternal(String source, String author, String text) {
          relayed.add(source + "|" + author + "|" + text);
        }
      };

  /** Queues main-thread work so tests can prove the hop happens. */
  private final Scheduler scheduler =
      new Scheduler() {
        @Override
        public void runOnMainThread(Runnable task) {
          mainThread.add(task);
        }

        @Override
        public Cancellable runOnMainThreadLater(Duration delay, Runnable task) {
          throw new UnsupportedOperationException();
        }

        @Override
        public Cancellable repeatOnMainThread(Duration delay, Duration period, Runnable task) {
          throw new UnsupportedOperationException();
        }

        @Override
        public Executor mainThread() {
          return this::runOnMainThread;
        }
      };

  private final DiscordRelay relay =
      new DiscordRelay(
          CONFIG, posts::add, new DiscordRelay.Game(chat, scheduler, () -> List.copyOf(online)));

  private void runMainThread() {
    var tasks = List.copyOf(mainThread);
    mainThread.clear();
    tasks.forEach(Runnable::run);
  }

  @Test
  void postsGameChatEscaped() {
    relay.onChatLine(
        new ChatLine(
            Instant.EPOCH,
            new ChatAuthor.InGame(UUID.randomUUID(), "cool_guy"),
            "@everyone **free** stuff"));

    assertThat(posts)
        .containsExactly("**cool\\_guy**: @" + ZWSP + "everyone \\*\\*free\\*\\* stuff");
  }

  @Test
  void doesNotEchoRelayedLines() {
    relay.onChatLine(new ChatLine(Instant.EPOCH, new ChatAuthor.External("D", "bob"), "hi"));

    assertThat(posts).isEmpty();
  }

  @Test
  void relaysDiscordIntoGlobalOnTheMainThread() {
    relay.onDiscordMessage(new InboundMessage("bob", "hello\nthere **friend**", false, 0));

    assertThat(relayed).as("nothing touches the game off the main thread").isEmpty();
    runMainThread();
    assertThat(relayed).containsExactly("D|bob|hello there friend");
  }

  @Test
  void skipsBotsAndCutsLongMessages() {
    relay.onDiscordMessage(new InboundMessage("bridge", "echo", true, 0));
    relay.onDiscordMessage(new InboundMessage("bob", "x".repeat(50), false, 0));
    runMainThread();

    assertThat(relayed).singleElement().asString().startsWith("D|bob|" + "x".repeat(19));
  }

  @Test
  void postsServerEvents() {
    relay.onJoin("Alice");
    relay.onLeave("Alice");
    relay.onDeath("Alice was slain by Zombie");
    relay.onDeath(" ");
    relay.onAdvancement("Alice", "story/mine_stone", "Stone Age", true);
    relay.onAdvancement("Alice", "recipes/misc/torch", "", false);
    relay.onAdvancement("Alice", "story/secret", "Hidden", false);
    relay.onServerStarted();

    assertThat(posts)
        .containsExactly(
            "**Alice** joined",
            "**Alice** left",
            "Alice was slain by Zombie",
            "**Alice** got **Stone Age**",
            "The Storm has woken up");
    assertThat(relay.stopMessage()).isEqualTo("The Storm sleeps. Join ts-mc.net to wake it.");
    assertThat(relay.status()).isEqualTo("Awake");
  }

  @Test
  void listsPlayersOnTheMainThread() {
    var replies = new ArrayList<String>();
    online.add("Bob");
    online.add("alice");

    relay.listPlayers(replies::add);

    assertThat(replies).isEmpty();
    runMainThread();
    assertThat(replies).containsExactly("Online (2): alice, Bob");

    online.clear();
    relay.listPlayers(replies::add);
    runMainThread();
    assertThat(replies).last().isEqualTo("Nobody is online.");
  }
}
