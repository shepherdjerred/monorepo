package com.shepherdjerred.thestorm.rwfbots;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Location;
import org.bukkit.WorldCreator;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.entity.PlayerMock;
import org.mockbukkit.mockbukkit.world.WorldMock;

/**
 * Bot chat in the lobby on MockBukkit: bots greet as they walk in, a human's "hi" in chat gets at
 * most one greeting back, and nobody outside the rwf world hears any of it.
 */
final class BotLobbyChatTest {

  @TempDir Path directory;
  private @Nullable RwfBotsHarness running;

  @AfterEach
  void stop() {
    if (running != null) {
      running.close();
    }
  }

  /** The shipped config with greetings certain and said at once; small talk and the rest silent. */
  private static String greetingsOnly(String yaml) {
    var out = yaml;
    for (var moment :
        List.of(
            "onKill",
            "onDeath",
            "onPlant",
            "onDefuse",
            "onWin",
            "onLoss",
            "onLastAlive",
            "taunt",
            "lobby")) {
      out = out.replaceFirst("(?m)^    " + moment + ": [0-9.]+$", "    " + moment + ": 0.0");
    }
    return out.replaceFirst("(?m)^    greet: [0-9.]+$", "    greet: 1.0")
        .replace(
            "verbosity: { quiet: 0.4, normal: 1.0, chatty: 1.6 }",
            "verbosity: { quiet: 4.0, normal: 4.0, chatty: 4.0 }")
        .replace("reactionMinMillis: 600", "reactionMinMillis: 0")
        .replace("reactionMaxMillis: 1800", "reactionMaxMillis: 0");
  }

  private static List<String> heard(PlayerMock player) {
    var lines = new ArrayList<String>();
    for (var message = player.nextComponentMessage();
        message != null;
        message = player.nextComponentMessage()) {
      lines.add(PlainTextComponentSerializer.plainText().serialize(message));
    }
    return lines;
  }

  @Test
  void botsGreetAsTheyArriveAndOneAnswersAHumansHelloOnlyInTheRwfWorld() {
    var harness = RwfBotsHarness.start(directory, BotLobbyChatTest::greetingsOnly, h -> {});
    running = harness;
    var alice = harness.server.addPlayer("Alice");
    alice.teleport(new Location(harness.world, 4.5, 1, 20.5));
    var elsewhere = new WorldMock(new WorldCreator("world"));
    harness.server.addWorld(elsewhere);
    var bob = harness.server.addPlayer("Bob");
    bob.teleport(new Location(elsewhere, 0, 5, 0));
    harness.match.fireJoin(new CombatantId.Human(alice.getUniqueId()), alice.getName());
    harness.match.fireMapChosen();
    harness.match.phase(MatchSnapshot.PhaseKind.COUNTDOWN);
    harness.match.startsAt(harness.clock.instant().plus(Duration.ofSeconds(90)));
    harness.ticks(2);
    heard(alice);
    var bots = harness.roster().fill(FakeMatch.MATCH_ID, 3);
    for (var bot : bots) {
      harness.roster().spawn(bot, new Location(harness.world, 6.5, 1, 12.5));
      harness.match.fireJoin(bot, harness.roster().entity(bot).orElseThrow().getName());
    }
    harness.ticks(5);

    var greetings = heard(alice);
    assertThat(greetings).as("bots say hello as they walk in").isNotEmpty();
    assertThat(greetings).allMatch(line -> line.contains(" ✦]: ") && !line.contains("{"));

    harness.ticks(25 * 20);
    heard(alice);
    alice.chat("hi everyone");
    harness.server.getScheduler().waitAsyncEventsFinished();
    harness.ticks(40);

    var replies = heard(alice);
    assertThat(replies).as("one bot answers, once").hasSize(1);
    var names =
        bots.stream()
            .map(bot -> harness.paper().roster().bot(bot.uuid()).orElseThrow())
            .map(body -> body.name())
            .toList();
    for (var reply : replies) {
      var speaker = reply.substring(1, reply.indexOf(" ✦]"));
      assertThat(names).contains(speaker);
      var body =
          harness.paper().roster().live().stream()
              .filter(b -> b.name().equals(speaker))
              .findFirst()
              .orElseThrow();
      assertThat(body.drafted().personality().lines().greet())
          .anyMatch(line -> reply.endsWith("]: " + line));
    }
    assertThat(heard(bob)).as("nobody outside the rwf world hears bots").isEmpty();
    assertThat(harness.paper().chat().orElseThrow().enabled()).isTrue();
  }
}
