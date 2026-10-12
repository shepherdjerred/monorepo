package com.shepherdjerred.thestorm.rwfbots;

import static java.util.Objects.requireNonNull;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import com.shepherdjerred.thestorm.rwfbots.adapter.content.RwfBotsConfig;
import com.shepherdjerred.thestorm.rwfbots.adapter.paper.BotBody;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.bukkit.Location;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

/**
 * Bots in the lobby on MockBukkit: each picks the first kit of its lobby plan as it walks in,
 * switches through the same pick path humans use and ends on its drafted kit before the start, and
 * moves about the lobby's nav graph until the match goes live.
 */
final class RwfBotsLobbyTest {

  @TempDir Path directory;
  private @Nullable RwfBotsHarness running;

  @AfterEach
  void stop() {
    if (running != null) {
      running.close();
    }
  }

  /** A human, the map, a countdown ending a minute from now and {@code slots} bots walking in. */
  private List<CombatantId.Bot> countdown(RwfBotsHarness harness, PlayerMock alice, int slots) {
    harness.match.fireJoin(new CombatantId.Human(alice.getUniqueId()), alice.getName());
    harness.match.fireMapChosen();
    harness.match.phase(MatchSnapshot.PhaseKind.COUNTDOWN);
    harness.match.startsAt(harness.clock.instant().plus(Duration.ofSeconds(60)));
    alice.teleport(new Location(harness.world, 4.5, 1, 20.5));
    var bots = harness.roster().fill(FakeMatch.MATCH_ID, slots);
    for (var bot : bots) {
      harness.roster().spawn(bot, new Location(harness.world, 6.5, 1, 12.5));
      harness.match.fireJoin(bot, harness.roster().entity(bot).orElseThrow().getName());
    }
    return bots;
  }

  private static Map<String, List<String>> kitsByBot(List<String> actions) {
    var kits = new HashMap<String, List<String>>();
    for (var action : actions) {
      if (action.startsWith("kit ")) {
        var name = action.substring(4, action.lastIndexOf(' '));
        kits.computeIfAbsent(name, n -> new ArrayList<>())
            .add(action.substring(action.lastIndexOf(' ') + 1));
      }
    }
    return kits;
  }

  @Test
  void botsTryKitsThroughThePickPathAndEndOnTheirDraftedKit() {
    var harness = RwfBotsHarness.start(directory);
    running = harness;
    var alice = harness.server.addPlayer("Alice");
    countdown(harness, alice, 6);

    harness.ticks(57 * 20);

    var kits = kitsByBot(harness.match.actions());
    assertThat(kits).hasSize(6);
    var switched = 0;
    for (var bot : harness.paper().roster().live()) {
      var picks = requireNonNull(kits.get(bot.name()));
      var drafted = RwfBotsConfig.kitId(bot.drafted().kit());
      assertThat(picks.getLast()).as(bot.name()).isEqualTo(drafted);
      assertThat(picks).hasSizeLessThanOrEqualTo(4);
      assertThat(harness.match.member(bot.uuid()).kit()).contains(drafted);
      switched += picks.size() - 1;
    }
    assertThat(switched).as("someone changes their mind").isPositive();
  }

  @Test
  void botsMoveAboutTheLobbyUntilTheMatchGoesLive() {
    var harness = RwfBotsHarness.start(directory);
    running = harness;
    var alice = harness.server.addPlayer("Alice");
    countdown(harness, alice, 4);
    var start = new HashMap<String, Location>();
    for (var bot : harness.paper().roster().live()) {
      start.put(bot.name(), harness.bodies.player(bot.uuid()).getLocation().clone());
    }

    harness.ticks(20 * 20);

    var moved = 0;
    for (var bot : harness.paper().roster().live()) {
      if (harness
              .bodies
              .player(bot.uuid())
              .getLocation()
              .distance(requireNonNull(start.get(bot.name())))
          > 1) {
        moved++;
      }
    }
    assertThat(moved).as("bots wander, browse and walk up to people").isPositive();
    assertThat(harness.bodies.orders()).anyMatch(order -> order.startsWith("look "));

    harness.match.phase(MatchSnapshot.PhaseKind.LIVE);
    harness.bodies.orders();
    harness.tick();
    var lobbyOrders = harness.bodies.orders();
    assertThat(lobbyOrders)
        .noneMatch(order -> order.startsWith("sneak ") && order.endsWith(" true"));
    for (BotBody bot : harness.paper().roster().live()) {
      assertThat(harness.bodies.player(bot.uuid()).isSneaking()).isFalse();
    }
  }
}
