package com.shepherdjerred.thestorm.rwfbots;

import static java.util.Objects.requireNonNull;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEvent;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import com.shepherdjerred.thestorm.rwfbots.adapter.content.RwfBotsConfig;
import com.shepherdjerred.thestorm.rwfbots.domain.chat.Chattiness;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Lines;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.function.Consumer;
import net.kyori.adventure.text.format.NamedTextColor;
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
 * Bot chat on MockBukkit: a bot's kill is said, at most once, from the killer's own kill lines,
 * framed with the ✦ marker, to the humans in the rwf world (members and watchers) and to nobody
 * outside it; with the managed flag off the bots say nothing.
 */
final class BotChatTest {

  @TempDir Path directory;
  private @Nullable RwfBotsHarness running;

  @AfterEach
  void stop() {
    if (running != null) {
      running.close();
    }
  }

  /**
   * The shipped config with a kill line certain (base chance 1, every verbosity at its 4x cap) and
   * said the moment it happens; every other moment silent.
   */
  private static String killsOnly(String yaml) {
    var out = yaml;
    for (var moment :
        List.of(
            "greet", "onDeath", "onPlant", "onDefuse", "onWin", "onLoss", "onLastAlive", "taunt")) {
      out = out.replaceFirst("(?m)^    " + moment + ": [0-9.]+$", "    " + moment + ": 0.0");
    }
    return out.replaceFirst("(?m)^    onKill: [0-9.]+$", "    onKill: 1.0")
        .replace(
            "verbosity: { quiet: 0.4, normal: 1.0, chatty: 1.6 }",
            "verbosity: { quiet: 4.0, normal: 4.0, chatty: 4.0 }")
        .replace("reactionMinMillis: 600", "reactionMinMillis: 0")
        .replace("reactionMaxMillis: 1800", "reactionMaxMillis: 0");
  }

  private RwfBotsHarness start(Consumer<RwfBotsHarness> before) {
    running = RwfBotsHarness.start(directory, BotChatTest::killsOnly, before);
    return running;
  }

  private RwfBotsHarness harness() {
    return requireNonNull(running);
  }

  /** Alice and two bots, red and blue, live on the synthetic map. */
  private List<CombatantId.Bot> live(PlayerMock alice) {
    var harness = harness();
    harness.match.fireJoin(new CombatantId.Human(alice.getUniqueId()), alice.getName());
    harness.match.fireMapChosen();
    var bots = harness.roster().fill(FakeMatch.MATCH_ID, 2);
    for (var bot : bots) {
      harness.roster().spawn(bot, new Location(harness.world, 16.5, 1, 16.5));
      harness.match.fireJoin(bot, harness.roster().entity(bot).orElseThrow().getName());
    }
    harness.match.fighting(alice.getUniqueId(), TeamColor.BLUE, "trooper");
    alice.teleport(new Location(harness.world, 30.5, 1, 30.5));
    var red = true;
    for (var bot : bots) {
      var kit = harness.match.member(bot.uuid()).kit().orElse("trooper");
      harness.match.fighting(bot.uuid(), red ? TeamColor.RED : TeamColor.BLUE, kit);
      red = !red;
    }
    harness.match.phase(MatchSnapshot.PhaseKind.LIVE);
    harness.match.fireTick();
    harness.ticks(5);
    return bots;
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

  private void killAlice(PlayerMock alice, CombatantId.Bot killer) {
    var harness = harness();
    harness.match.kill(alice.getUniqueId());
    harness.match.fire(
        new MatchEvent.Died(
            new CombatantId.Human(alice.getUniqueId()),
            Optional.of(killer),
            AttackType.MELEE,
            FakeMatch.T0),
        List.of());
    harness.tick();
  }

  @Test
  void aBotsKillIsSaidOnceFromItsKillLinesToTheRwfWorldOnly() {
    var harness = start(h -> {});
    var alice = harness.server.addPlayer("Alice");
    var watcher = harness.server.addPlayer("Carol");
    watcher.teleport(new Location(harness.world, 16.5, 4, 16.5));
    var elsewhere = new WorldMock(new WorldCreator("world"));
    harness.server.addWorld(elsewhere);
    var bob = harness.server.addPlayer("Bob");
    bob.teleport(new Location(elsewhere, 0, 5, 0));
    var bots = live(alice);
    assertThat(harness.paper().chat().orElseThrow().enabled()).isTrue();
    heard(alice);
    heard(watcher);
    heard(bob);

    var killer = bots.getFirst();
    var body = harness.paper().roster().bot(killer.uuid()).orElseThrow();
    var personality = body.drafted().personality();
    assertThat(
            Chattiness.chance(
                ConfigFiles.load(directory.resolve(RwfBotsModule.CONFIG), RwfBotsConfig.class)
                    .chat()
                    .toSettings(),
                personality,
                Lines.Moment.ON_KILL,
                Chattiness.Context.PLAIN))
        .as("the test config makes the kill line certain")
        .isEqualTo(1);
    killAlice(alice, killer);

    var expected =
        personality.lines().onKill().stream()
            .map(
                line ->
                    "["
                        + body.name()
                        + " ✦]: "
                        + line.replace("{victim}", "Alice").replace("{team}", "Red Team"))
            .toList();
    var aliceHeard = heard(alice);
    assertThat(aliceHeard).singleElement().isIn(expected);
    assertThat(heard(watcher)).as("watchers in the rwf world hear it too").isEqualTo(aliceHeard);
    assertThat(heard(bob)).as("nobody outside the rwf world hears bots").isEmpty();
    for (var bot : bots) {
      var entity = (PlayerMock) harness.roster().entity(bot).orElseThrow();
      assertThat(heard(entity)).as("bot bodies are not an audience").isEmpty();
    }

    harness.ticks(40);
    assertThat(heard(alice)).as("one kill, one line").isEmpty();
  }

  @Test
  void theLineIsFramedWithTheMarkerAndTheTeamColour() {
    var harness = start(h -> {});
    var alice = harness.server.addPlayer("Alice");
    var bots = live(alice);
    heard(alice);

    killAlice(alice, bots.getFirst());

    var message = requireNonNull(alice.nextComponentMessage());
    var parts = message.children();
    assertThat(parts).hasSize(4);
    assertThat(parts.get(0).color()).isEqualTo(NamedTextColor.RED);
    assertThat(PlainTextComponentSerializer.plainText().serialize(parts.get(1))).isEqualTo(" ✦");
    assertThat(parts.get(1).color()).isEqualTo(NamedTextColor.DARK_GRAY);
    assertThat(parts.get(3).color()).isEqualTo(NamedTextColor.GRAY);
  }

  @Test
  void withTheFlagOffBotsSayNothing() {
    var harness = start(h -> h.chatFlag.set(false));
    var alice = harness.server.addPlayer("Alice");
    var bots = live(alice);
    heard(alice);
    assertThat(harness.paper().chat().orElseThrow().enabled()).isFalse();

    killAlice(alice, bots.getFirst());

    assertThat(heard(alice)).isEmpty();
  }
}
