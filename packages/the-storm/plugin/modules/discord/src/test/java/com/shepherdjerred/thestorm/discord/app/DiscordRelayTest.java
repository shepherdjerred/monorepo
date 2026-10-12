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
import java.util.Optional;
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
              "Nobody is online.",
              "Ticket #{id} [{server}/{priority}] {category} from **{reporter}**: {summary}",
              "Ticket #{id} [{server}] claimed by **{staff}**",
              "Ticket #{id} [{server}] resolved by **{staff}**",
              "Ticket #{id} [{server}/{priority}] needs a human: {summary}",
              "Ticket #{id} [{server}] reopened",
              "Ticket #{id} [{server}] triaged [{priority}]: {evidence}",
              "**{player}** opened a Search and Destroy lobby",
              "{map}: **{team}** won in {duration}. GG {winners}",
              "{map}: draw after {duration}: {players}",
              "**{player}** opened {arena}",
              "{arena} boss wave {wave}: {boss}",
              "{arena} ({tier}) over at {wave}: {players}",
              "{arena} ({tier}) record {wave}: {players}",
              "**{player}** founded {town}",
              "{town} claims {claims}",
              "**{player}** completed {quest}",
              "**{player}** {skill} {level}",
              "{event} until {until}"),
          new LobbyPing(List.of("123456789012345678"), 30),
          new Milestones(List.of(25, 50), 100));

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

  private Instant now = Instant.parse("2026-10-11T12:00:00Z");

  /** Records quiet posts as they are and pings as {@code PING[roles] text}. */
  private final DiscordGateway gateway =
      new DiscordGateway() {
        @Override
        public void post(String text) {
          posts.add(text);
        }

        @Override
        public void ping(String text, List<String> roles) {
          posts.add("PING" + roles + " " + text);
        }
      };

  private final DiscordRelay relay =
      new DiscordRelay(
          CONFIG,
          gateway,
          new DiscordRelay.Game(chat, scheduler, () -> List.copyOf(online), () -> now));

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
  void postsTicketDetailsWithPlayerTextEscaped() {
    relay.onTicketOpened(
        new TicketDetails(
            7,
            "grief",
            "urgent",
            "cool_guy",
            "@everyone **help**",
            "staff",
            "evidence",
            "survival"));

    assertThat(posts)
        .containsExactly(
            "Ticket #7 [survival/urgent] grief from **cool\\_guy**: "
                + "@\u200Beveryone \\*\\*help\\*\\*");
  }

  @Test
  void relaysDiscordIntoGlobalOnTheMainThread() {
    relay.onDiscordMessage(new InboundMessage("bob", "hello\nthere **friend**", false, 0));

    assertThat(relayed).as("nothing touches the game off the main thread").isEmpty();
    runMainThread();
    assertThat(relayed).containsExactly("D|bob|hello there friend");
  }

  @Test
  void dropsDiscordMessagesOnceStopping() {
    relay.onDiscordMessage(new InboundMessage("bob", "queued before stop", false, 0));
    relay.stopRelaying();
    relay.onDiscordMessage(new InboundMessage("bob", "sent during stop", false, 0));

    assertThat(mainThread).as("nothing new is scheduled once stopping").hasSize(1);
    runMainThread();
    assertThat(relayed).as("a hop queued before stop is dropped when it runs").isEmpty();
  }

  @Test
  void listAnswersWithoutTheGameOnceStopping() {
    var replies = new ArrayList<String>();
    relay.stopRelaying();

    relay.listPlayers(replies::add);

    assertThat(mainThread).isEmpty();
    assertThat(replies).containsExactly("The Storm sleeps. Join ts-mc.net to wake it.");
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
    relay.addSeasonalEvents(() -> List.of(new SeasonalEvent("Storm*night*", "Nov 2")));
    relay.onServerStarted();

    assertThat(posts)
        .containsExactly(
            "**Alice** joined",
            "**Alice** left",
            "Alice was slain by Zombie",
            "**Alice** got **Stone Age**",
            "The Storm has woken up",
            "Storm\\*night\\* until Nov 2");
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

  @Test
  void postsSearchAndDestroyLobbiesAndResults() {
    relay.onRwfLobbyOpened("Alice_");
    relay.onRwfMatchEnded(
        new RwfMatchResult(
            "Desert *Ruins*",
            Optional.of("Red Team"),
            List.of("bob", "Alice"),
            List.of("bob", "Alice", "Carol"),
            Duration.ofSeconds(725)));
    relay.onRwfMatchEnded(
        new RwfMatchResult(
            "Docks",
            Optional.empty(),
            List.of(),
            List.of("Carol", "alice"),
            Duration.ofSeconds(42)));

    assertThat(posts)
        .containsExactly(
            "PING[123456789012345678] <@&123456789012345678> **Alice\\_** opened a Search and"
                + " Destroy lobby",
            "Desert \\*Ruins\\*: **Red Team** won in 12m 5s. GG Alice, bob",
            "Docks: draw after 42s: alice, Carol");
  }

  @Test
  void pingsEachGamesLobbyOncePerCooldown() {
    relay.onRwfLobbyOpened("Alice");
    relay.onArenaLobbyOpened("Rustworks", "Bob");
    now = now.plus(Duration.ofMinutes(29));
    relay.onRwfLobbyOpened("Carol");
    now = now.plus(Duration.ofMinutes(1));
    relay.onRwfLobbyOpened("Dave");

    assertThat(posts)
        .containsExactly(
            "PING[123456789012345678] <@&123456789012345678> **Alice** opened a Search and Destroy"
                + " lobby",
            "PING[123456789012345678] <@&123456789012345678> **Bob** opened Rustworks",
            "**Carol** opened a Search and Destroy lobby",
            "PING[123456789012345678] <@&123456789012345678> **Dave** opened a Search and Destroy"
                + " lobby");
  }

  @Test
  void postsArenaBossWavesRunsAndRecords() {
    relay.onArenaBossWave("Rust*works*", 30, "The Foreman");
    relay.onArenaRunEnded(
        new ArenaRunResult(
            "Rustworks",
            "Ominous II",
            List.of(new ArenaRunResult.Player("bob", 31), new ArenaRunResult.Player("Alice", 34)),
            false));
    relay.onArenaRunEnded(
        new ArenaRunResult(
            "Rustworks", "Ominous II", List.of(new ArenaRunResult.Player("Carol", 50)), true));

    assertThat(posts)
        .containsExactly(
            "Rust\\*works\\* boss wave 30: The Foreman",
            "Rustworks (Ominous II) over at 34: Alice (34), bob (31)",
            "Rustworks (Ominous II) record 50: Carol (50)");
  }

  @Test
  void postsTownQuestAndSkillMilestones() {
    var town = UUID.randomUUID();
    relay.onTownFounded("Rivers*end*", "Alice");
    relay.onTownGrew(town, "Riversend", 24);
    relay.onTownGrew(town, "Riversend", 25);
    relay.onTownGrew(town, "Riversend", 25);
    relay.onQuestMilestone("Bob", "The Storm Watch");
    relay.onSkillLevelUp("Carol", "Mining", 98, 99);
    relay.onSkillLevelUp("Carol", "Mining", 99, 201);

    assertThat(posts)
        .containsExactly(
            "**Alice** founded Rivers\\*end\\*",
            "Riversend claims 25",
            "**Bob** completed The Storm Watch",
            "**Carol** Mining 200");
  }
}
