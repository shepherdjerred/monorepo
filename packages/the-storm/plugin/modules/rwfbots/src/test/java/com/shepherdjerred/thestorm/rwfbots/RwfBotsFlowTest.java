package com.shepherdjerred.thestorm.rwfbots;

import static java.util.Objects.requireNonNull;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEffect;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEvent;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import com.shepherdjerred.thestorm.rwf.domain.match.Outcome;
import com.shepherdjerred.thestorm.rwfbots.adapter.db.JooqPersonalityStatsStore;
import com.shepherdjerred.thestorm.rwfbots.adapter.paper.BotBody;
import com.shepherdjerred.thestorm.rwfbots.app.PersonalityStats;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.bukkit.Location;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

/**
 * A whole match from the bots' side on MockBukkit: the module enables over the shipped content,
 * fills a lobby around a human, picks kits, thinks and moves once live, starts new lives on death,
 * tallies and rates at the end, writes traces, answers the debug command and despawns on disable.
 */
final class RwfBotsFlowTest {

  @TempDir Path directory;
  private @Nullable RwfBotsHarness running;

  @AfterEach
  void stop() {
    if (running != null) {
      running.close();
    }
  }

  private RwfBotsHarness harness() {
    return requireNonNull(running);
  }

  private RwfBotsHarness start() {
    running = RwfBotsHarness.start(directory);
    return running;
  }

  /** Joins a human, chooses the map and fills the lobby with {@code slots} bots. */
  private List<CombatantId.Bot> lobby(PlayerMock alice, int slots) {
    var harness = harness();
    harness.match.fireJoin(new CombatantId.Human(alice.getUniqueId()), alice.getName());
    harness.match.fireMapChosen();
    var bots = harness.roster().fill(FakeMatch.MATCH_ID, slots);
    for (var bot : bots) {
      harness.roster().spawn(bot, new Location(harness.world, 16.5, 1, 16.5));
      var entity = harness.roster().entity(bot).orElseThrow();
      harness.match.fireJoin(bot, entity.getName());
    }
    return bots;
  }

  /** Puts everyone on teams with kits and goes live. */
  private void goLive(PlayerMock alice, List<CombatantId.Bot> bots) {
    var harness = harness();
    harness.match.fighting(alice.getUniqueId(), TeamColor.BLUE, "trooper");
    alice.teleport(new Location(harness.world, 30.5, 1, 30.5));
    var red = true;
    for (var bot : bots) {
      var kit = harness.match.member(bot.uuid()).kit().orElse("trooper");
      harness.match.fighting(bot.uuid(), red ? TeamColor.RED : TeamColor.BLUE, kit);
      harness
          .roster()
          .entity(bot)
          .orElseThrow()
          .teleport(
              red
                  ? new Location(harness.world, 2.5, 1, 2.5)
                  : new Location(harness.world, 30.5, 1, 28.5));
      red = !red;
    }
    harness.match.phase(MatchSnapshot.PhaseKind.LIVE);
    harness.match.fireTick();
  }

  @Test
  void theLobbyIsFilledWithPersonalitiesThatPickTheirKits() {
    var harness = start();
    var alice = harness.server.addPlayer("Alice");

    var bots = lobby(alice, 3);

    assertThat(bots).hasSize(3);
    assertThat(bots).extracting(CombatantId.Bot::personalityId).doesNotHaveDuplicates();
    assertThat(harness.bodies.spawned()).hasSize(3);
    assertThat(harness.roster().isBot(bots.getFirst().uuid())).isTrue();
    assertThat(harness.roster().isBot(alice.getUniqueId())).isFalse();
    var actions = harness.match.actions();
    assertThat(actions).hasSize(3).allMatch(action -> action.startsWith("kit "));
    assertThat(actions)
        .allMatch(
            action ->
                List.of("trooper", "longbow", "shortbow", "rewind")
                    .contains(action.substring(action.lastIndexOf(' ') + 1)));
    assertThat(harness.paper().roster().live()).extracting(BotBody::name).doesNotContain("Alice");
  }

  @Test
  void aMapWithoutACurrentNavArtifactRunsHumansOnly() {
    var harness = start();
    var alice = harness.server.addPlayer("Alice");
    harness.match.fireJoin(new CombatantId.Human(alice.getUniqueId()), alice.getName());
    // The map was chosen with other blocks than the artifact was baked from.
    var stale = new FakeMatch("f".repeat(64));
    harness.match.fire(new MatchEvent.MapChosen(stale.map()), List.of());

    assertThat(harness.roster().fill(FakeMatch.MATCH_ID, 3)).isEmpty();
    assertThat(harness.bodies.created()).isZero();
  }

  @Test
  void liveBotsThinkMoveAndStartNewLivesWhenTheyDie() {
    var harness = start();
    var alice = harness.server.addPlayer("Alice");
    var bots = lobby(alice, 4);
    harness.match.actions();

    goLive(alice, bots);
    var loop = harness.paper().loop();
    assertThat(loop.inMatch()).isTrue();
    assertThat(loop.profiles()).hasSize(4);
    harness.ticks(30);

    var board = loop.board();
    assertThat(board.thoughts()).hasSize(4);
    assertThat(board.tick()).isGreaterThan(0);
    var orders = harness.bodies.orders();
    assertThat(orders).anyMatch(order -> order.startsWith("look "));
    assertThat(orders).anyMatch(order -> order.startsWith("move ") || order.startsWith("stop "));
    var live = harness.paper().roster().live();
    assertThat(live).allMatch(bot -> !bot.planLabel().equals("-"));

    var victim = bots.getFirst();
    var profile = harness.paper().roster().bot(victim.uuid()).orElseThrow().profile().orElseThrow();
    assertThat(loop.epoch(profile.id())).isZero();
    harness.match.kill(victim.uuid());
    harness.match.fire(
        new MatchEvent.Died(
            victim,
            Optional.of(new CombatantId.Human(alice.getUniqueId())),
            AttackType.MELEE,
            FakeMatch.T0),
        List.of(new MatchEffect.Spectate(victim, harness.match.map().spectatorPoint())));
    assertThat(loop.epoch(profile.id())).isEqualTo(2);
    assertThat(harness.paper().roster().bot(victim.uuid()).orElseThrow().tally().deaths())
        .isEqualTo(1);
    harness.ticks(10);
    var stale = loop.board().of(profile.id()).orElseThrow();
    assertThat(stale.lifeEpoch()).as("the dead bot's thought is from its old life").isLessThan(2);
    assertThat(stale.decision().snapshotTick())
        .as("the dead bot stopped thinking")
        .isLessThan(loop.board().tick() - 5);
  }

  @Test
  void aMatchThatEndsUnderOneBotsOrdersDrivesNoOtherBotThatTick() {
    var harness = start();
    var alice = harness.server.addPlayer("Alice");
    var bots = lobby(alice, 4);
    goLive(alice, bots);
    harness.ticks(30);
    harness.bodies.orders();

    // A bot's order is a killing blow: rwf ends the match before the ticker returns.
    harness.bodies.afterNextOrder(
        () -> {
          harness.match.phase(MatchSnapshot.PhaseKind.ENDED);
          harness.match.outcome(new Outcome.Winner(TeamColor.RED));
          harness.match.fireTick();
        });
    harness.tick();

    assertThat(harness.paper().loop().inMatch()).isFalse();
    assertThat(harness.paper().roster().session()).isEmpty();
    var orders = harness.bodies.orders();
    var ordered =
        harness.paper().roster().live().stream()
            .map(BotBody::name)
            .filter(name -> orders.stream().anyMatch(order -> ordersBy(order, name)))
            .toList();
    assertThat(ordered).as("only the bot whose order ended the match was driven").hasSize(1);
    harness.ticks(5);
    assertThat(harness.bodies.orders()).isEmpty();
  }

  /** Whether {@code order}, as {@code <kind> <name> [detail]}, was given to {@code name}. */
  private static boolean ordersBy(String order, String name) {
    var named = order.substring(order.indexOf(' ') + 1);
    return named.equals(name) || named.startsWith(name + " ");
  }

  @Test
  void aFinishedMatchRatesThePersonalitiesWritesTracesAndAnswersTheDebugCommand() {
    var harness = start();
    var alice = harness.server.addPlayer("Alice");
    var bots = lobby(alice, 2);
    goLive(alice, bots);
    harness.ticks(20);
    // The red bot's click finishes arming the blue bomb.
    harness.match.blueArmed(true);
    harness.match.fire(
        new MatchEvent.BombClicked(bots.getFirst(), FakeMatch.BLUE_BOMB, FakeMatch.T0),
        List.of(new MatchEffect.RecordStat(bots.getFirst(), "Armed")));
    assertThat(harness.paper().roster().bot(bots.getFirst().uuid()).orElseThrow().tally().plants())
        .isEqualTo(1);

    var operator = harness.server.addPlayer("Op");
    operator.setOp(true);
    operator.performCommand("rwfbots debug");
    var lines = new ArrayList<String>();
    for (var message = operator.nextMessage(); message != null; message = operator.nextMessage()) {
      lines.add(message);
    }
    assertThat(lines).anyMatch(line -> line.contains("governor level 0"));
    assertThat(lines).anyMatch(line -> line.contains("plan "));

    operator.performCommand("rwfbots debug slots");
    var slots = new ArrayList<String>();
    for (var message = operator.nextMessage(); message != null; message = operator.nextMessage()) {
      slots.add(message);
    }
    assertThat(slots).anyMatch(line -> line.contains("objective"));
    assertThat(slots).anyMatch(line -> line.contains(" holds ") && line.contains(", lane "));
    assertThat(slots).anyMatch(line -> line.contains("drawing slots"));
    harness.ticks(30);

    harness.match.phase(MatchSnapshot.PhaseKind.ENDED);
    harness.match.outcome(new Outcome.Winner(TeamColor.RED));
    harness.match.fireTick();

    assertThat(harness.paper().loop().inMatch()).isFalse();
    var stored = new JooqPersonalityStatsStore(harness.database).loadAll().join();
    assertThat(stored).hasSize(2);
    var winner =
        stored.stream()
            .filter(s -> s.personalityId().equals(bots.getFirst().personalityId()))
            .findFirst()
            .orElseThrow();
    assertThat(winner.matches()).isEqualTo(1);
    assertThat(winner.wins()).isEqualTo(1);
    assertThat(winner.plants()).isEqualTo(1);
    var loser =
        stored.stream()
            .filter(s -> s.personalityId().equals(bots.get(1).personalityId()))
            .findFirst()
            .orElseThrow();
    assertThat(loser.wins()).isZero();
    var roster = harness.paper().roster();
    var winnerBefore = roster.bot(bots.getFirst().uuid()).orElseThrow().drafted().rating();
    var loserBefore = roster.bot(bots.get(1).uuid()).orElseThrow().drafted().rating();
    assertThat(winner.rating().mu()).isGreaterThan(winnerBefore.mu());
    assertThat(loser.rating().mu()).isLessThan(loserBefore.mu());
    assertThat(stored).extracting(PersonalityStats::lastSeen).allMatch(FakeMatch.T0::isBefore);
    assertThat(directory.resolve("rwfbots-traces").resolve(FakeMatch.MATCH_ID + ".gz")).exists();

    harness.module.disable();
    assertThat(harness.bodies.spawned()).isEmpty();
    assertThat(harness.match.listeners()).isZero();
  }
}
