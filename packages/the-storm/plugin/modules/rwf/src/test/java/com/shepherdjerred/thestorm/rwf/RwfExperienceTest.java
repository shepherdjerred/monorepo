package com.shepherdjerred.thestorm.rwf;

import static com.shepherdjerred.thestorm.rwf.RwfHarness.messages;
import static java.util.Objects.requireNonNull;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.chat.app.ChannelRegistry;
import com.shepherdjerred.thestorm.chat.app.ChannelRouter;
import com.shepherdjerred.thestorm.chat.app.ChatChannel;
import com.shepherdjerred.thestorm.chat.app.ChatExtensions;
import com.shepherdjerred.thestorm.chat.domain.ChannelKey;
import com.shepherdjerred.thestorm.rwf.app.RwfFeatures;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot.PhaseKind;
import java.nio.file.Path;
import java.time.Duration;
import java.util.UUID;
import org.bukkit.event.player.PlayerMoveEvent;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

/**
 * The match experience on MockBukkit with every managed feature on: the map preview and the freeze
 * before the start, the death feed, and the humans carried from one match into the next without
 * joining again.
 */
final class RwfExperienceTest {

  @TempDir Path directory;
  private @Nullable RwfHarness running;

  @AfterEach
  void stop() {
    if (running != null) {
      running.close();
    }
  }

  private RwfHarness start() {
    var harness = RwfHarness.prepare(directory);
    running = harness;
    harness.features = RwfFeatures.ALL;
    return harness.enable(directory);
  }

  /** Ticks a second at a time until the match is in {@code phase}, for at most {@code seconds}. */
  private static void tickUntil(RwfHarness harness, PhaseKind phase, int seconds) {
    for (var i = 0; i < seconds && harness.snapshot().phase() != phase; i++) {
      harness.tick(Duration.ofSeconds(1));
    }
    harness.until(() -> harness.snapshot().phase() == phase);
  }

  private static TeamColor teamOf(RwfHarness harness, PlayerMock player) {
    return harness.combatant(player).team().orElseThrow();
  }

  /** Runs the countdown out: the map previews, then everyone freezes at their start. */
  private static void toFreeze(RwfHarness harness, PlayerMock alice) {
    harness.enter(alice);
    harness.until(() -> harness.snapshot().phase() == PhaseKind.COUNTDOWN);
    harness.letBotsArrive();
    tickUntil(harness, PhaseKind.PREVIEW, 40);
    tickUntil(harness, PhaseKind.FREEZE, 11);
  }

  @Test
  void forcedStartActivatesTheFirstMapBeforeItsLiveEffects() {
    var harness = RwfHarness.prepare(directory);
    running = harness;
    var chunks = harness.deferMapChunks();
    harness.enable(directory);
    var alice = harness.loadedPlayer("Alice");
    var bob = harness.loadedPlayer("Bob");
    harness.enter(alice);
    harness.enter(bob);
    harness.server.dispatchCommand(harness.server.getConsoleSender(), "rwf admin start");
    assertThat(harness.snapshot().phase()).isEqualTo(PhaseKind.PREPARING);

    chunks.complete(null);
    harness.until(() -> harness.snapshot().phase() == PhaseKind.LIVE);
    harness.ticks(2);

    assertThat(harness.snapshot().mapId()).contains("training-yard");
    assertThat(alice.getWorld()).isEqualTo(harness.rwf);
    assertThat(bob.getWorld()).isEqualTo(harness.rwf);
    assertThat(harness.combatant(alice).team()).isPresent();
    assertThat(harness.combatant(bob).team()).isPresent();
  }

  @Test
  void countdownReadModelsKeepTimeBetweenMatchTransitionsAndAreReusedWithinATick() {
    var harness = start();
    var alice = harness.loadedPlayer("Alice");
    harness.enter(alice);
    harness.until(() -> harness.snapshot().phase() == PhaseKind.COUNTDOWN);
    harness.letBotsArrive();
    harness.tick(Duration.ofMillis(100));
    var before = harness.snapshot();
    assertThat(harness.snapshot()).isSameAs(before);

    harness.tick(Duration.ofMillis(100));
    var after = harness.snapshot();
    assertThat(after.phase()).isEqualTo(PhaseKind.COUNTDOWN);
    assertThat(after.startsAt()).isEqualTo(before.startsAt());
    assertThat(after.now()).isEqualTo(before.now().plusMillis(100));
    assertThat(harness.snapshot()).isSameAs(after);
  }

  @Test
  void theMapPreviewsThenEveryoneFreezesAtTheirStartUntilTheGameBegins() {
    var harness = start();
    var alice = harness.loadedPlayer("Alice");
    harness.enter(alice);
    harness.until(() -> harness.snapshot().phase() == PhaseKind.COUNTDOWN);
    harness.letBotsArrive();
    tickUntil(harness, PhaseKind.PREVIEW, 40);

    assertThat(alice.getWorld()).isEqualTo(harness.rwf);
    assertThat(harness.combatant(alice).team()).isEmpty();

    tickUntil(harness, PhaseKind.FREEZE, 11);

    assertThat(harness.combatant(alice).team()).isPresent();
    var at = alice.getLocation();
    var step = new PlayerMoveEvent(alice, at, at.clone().add(1, 0, 0));
    harness.server.getPluginManager().callEvent(step);
    assertThat(step.isCancelled() || requireNonNull(step.getTo()).getX() == at.getX()).isTrue();

    tickUntil(harness, PhaseKind.LIVE, 6);
    var walk = new PlayerMoveEvent(alice, at, at.clone().add(1, 0, 0));
    harness.server.getPluginManager().callEvent(walk);
    assertThat(walk.isCancelled()).isFalse();
  }

  @Test
  void nobodyFallsForeverBeforeTheMatchGoesLiveOrAfterTheyDie() {
    var harness = start();
    var alice = harness.loadedPlayer("Alice");
    harness.enter(alice);
    harness.until(() -> harness.snapshot().phase() == PhaseKind.COUNTDOWN);
    var lobbySpawn = alice.getLocation().clone();

    // Off the lobby deck: back at its spawn, unhurt.
    alice.teleport(lobbySpawn.clone().add(0, -80, 0));
    harness.ticks(2);
    assertThat(alice.getWorld()).isEqualTo(harness.lobbyWorld);
    assertThat(alice.getLocation().distance(lobbySpawn)).isLessThan(2);
    assertThat(alice.getHealth()).isEqualTo(20);

    harness.letBotsArrive();
    tickUntil(harness, PhaseKind.PREVIEW, 40);
    var overview = alice.getLocation().clone();
    // Below the map during the preview: back at the overview point.
    alice.teleport(overview.clone().add(0, -200, 0));
    harness.ticks(2);
    assertThat(alice.getLocation().getY()).isGreaterThan(overview.getY() - 50);

    tickUntil(harness, PhaseKind.FREEZE, 11);
    var start = alice.getLocation().clone();
    // Frozen at a start, then dropped: back at that start.
    alice.teleport(start.clone().add(0, -200, 0));
    harness.ticks(2);
    assertThat(alice.getLocation().distance(start)).isLessThan(1);

    tickUntil(harness, PhaseKind.LIVE, 6);
    var killer =
        harness.bots.spawned().stream()
            .filter(
                bot ->
                    harness
                        .snapshot()
                        .combatant(harness.bots.idOf(bot).orElseThrow())
                        .flatMap(MatchSnapshot.CombatantView::team)
                        .filter(team -> !team.equals(teamOf(harness, alice)))
                        .isPresent())
            .findFirst()
            .orElseThrow();
    for (var i = 0; i < 40 && harness.combatant(alice).alive(); i++) {
      swing(harness, killer, alice);
    }
    alice.respawn();
    harness.tick(Duration.ofSeconds(5));
    // A ghost who stops flying and drops through the map is put back over it.
    var ghostAt = alice.getLocation().clone();
    alice.teleport(ghostAt.clone().add(0, -200, 0));
    harness.ticks(2);
    assertThat(alice.getLocation().getY()).isGreaterThan(ghostAt.getY() - 100);
  }

  @Test
  void aDeathIsAnnouncedAndSharedBetweenTheKillerAndAnAssist() {
    var harness = start();
    var alice = harness.loadedPlayer("Alice");
    toFreeze(harness, alice);
    tickUntil(harness, PhaseKind.LIVE, 6);
    messages(alice);
    var enemy = teamOf(harness, alice) == TeamColor.RED ? TeamColor.BLUE : TeamColor.RED;
    var enemies =
        harness.bots.spawned().stream()
            .filter(
                bot ->
                    harness
                        .snapshot()
                        .combatant(harness.bots.idOf(bot).orElseThrow())
                        .flatMap(MatchSnapshot.CombatantView::team)
                        .filter(enemy::equals)
                        .isPresent())
            .toList();
    var killer = enemies.get(0);
    var helper = enemies.get(1);

    // The helper lands three hits, then the killer finishes Alice off.
    for (var i = 0; i < 3; i++) {
      swing(harness, helper, alice);
    }
    for (var i = 0; i < 40 && harness.combatant(alice).alive(); i++) {
      swing(harness, killer, alice);
    }

    assertThat(harness.combatant(alice).alive()).isFalse();
    assertThat(messages(alice))
        .anySatisfy(line -> assertThat(line).contains("Alice").contains(killer.getName()));
    var killerScore =
        harness.snapshot().combatant(harness.bots.idOf(killer).orElseThrow()).orElseThrow().score();
    var helperScore =
        harness.snapshot().combatant(harness.bots.idOf(helper).orElseThrow()).orElseThrow().score();
    assertThat(killerScore.kills()).isEqualTo(1);
    assertThat(helperScore.kills()).isZero();
    assertThat(helperScore.assists()).isEqualTo(1);
  }

  /**
   * {@code attacker} hits {@code victim} as the server reports it. MockBukkit's {@code damage}
   * skips the by-entity event and never counts the hit window down, so each hit is simulated from a
   * closed window.
   */
  private static void swing(RwfHarness harness, PlayerMock attacker, PlayerMock victim) {
    victim.setNoDamageTicks(0);
    victim.simulateDamage(6, attacker);
    harness.tick(Duration.ofSeconds(1));
  }

  @Test
  void teamChatReachesOnlyTheLivingTeamAndTheDeadTalkAmongThemselves() {
    var chat = new ChatExtensions();
    var harness = RwfHarness.prepare(directory);
    running = harness;
    harness.features = RwfFeatures.ALL;
    harness.services.provide(ChannelRegistry.class, chat);
    harness.enable(directory);
    var alice = harness.loadedPlayer("Alice");
    toFreeze(harness, alice);
    tickUntil(harness, PhaseKind.LIVE, 6);
    var team = teamOf(harness, alice);
    var mates = new java.util.HashSet<UUID>();
    var enemies = new java.util.HashSet<UUID>();
    for (var view : harness.snapshot().combatants()) {
      (view.team().filter(team::equals).isPresent() ? mates : enemies).add(view.id().uuid());
    }
    var speaker = alice.getUniqueId();

    assertThat(chat.membership(ChannelKey.TEAM).orElseThrow().members(speaker))
        .hasValueSatisfying(
            heard -> assertThat(heard).isEqualTo(mates).doesNotContainAnyElementsOf(enemies));
    assertThat(
            chat.route(new ChannelRouter.Request(speaker, ChatChannel.GLOBAL, "push mid", false)))
        .contains(new ChannelRouter.Routed(ChatChannel.TEAM, "push mid"));
    assertThat(chat.route(new ChannelRouter.Request(speaker, ChatChannel.GLOBAL, "@gg all", false)))
        .contains(new ChannelRouter.Routed(ChatChannel.GLOBAL, "gg all"));

    var killer =
        harness.bots.spawned().stream()
            .filter(bot -> enemies.contains(bot.getUniqueId()))
            .findFirst()
            .orElseThrow();
    for (var i = 0; i < 40 && harness.combatant(alice).alive(); i++) {
      swing(harness, killer, alice);
    }

    assertThat(chat.route(new ChannelRouter.Request(speaker, ChatChannel.GLOBAL, "unlucky", false)))
        .contains(new ChannelRouter.Routed(ChatChannel.DEAD, "unlucky"));
    assertThat(chat.membership(ChannelKey.DEAD).orElseThrow().members(speaker))
        .hasValueSatisfying(
            heard ->
                assertThat(heard)
                    .contains(speaker)
                    .doesNotContainAnyElementsOf(
                        mates.stream().filter(id -> !id.equals(speaker)).toList()));
    assertThat(chat.membership(ChannelKey.TEAM).orElseThrow().members(speaker)).isEmpty();
  }

  @Test
  void theDeadWatchTheirKillerThenOpenThePlayerMenuWithTheCompass() {
    var harness = start();
    var alice = harness.loadedPlayer("Alice");
    toFreeze(harness, alice);
    tickUntil(harness, PhaseKind.LIVE, 6);
    var enemy = teamOf(harness, alice) == TeamColor.RED ? TeamColor.BLUE : TeamColor.RED;
    var killer =
        harness.bots.spawned().stream()
            .filter(
                bot ->
                    harness
                        .snapshot()
                        .combatant(harness.bots.idOf(bot).orElseThrow())
                        .flatMap(MatchSnapshot.CombatantView::team)
                        .filter(enemy::equals)
                        .isPresent())
            .findFirst()
            .orElseThrow();
    for (var i = 0; i < 40 && harness.combatant(alice).alive(); i++) {
      swing(harness, killer, alice);
    }
    alice.respawn();
    for (var i = 0; i < 5; i++) {
      harness.tick(Duration.ofSeconds(1));
    }
    var compass = alice.getInventory().getItem(0);
    assertThat(compass).isNotNull();
    assertThat(requireNonNull(compass).getType()).isEqualTo(org.bukkit.Material.COMPASS);

    harness
        .server
        .getPluginManager()
        .callEvent(
            new org.bukkit.event.player.PlayerInteractEvent(
                alice,
                org.bukkit.event.block.Action.RIGHT_CLICK_AIR,
                compass,
                null,
                org.bukkit.block.BlockFace.SELF));

    assertThat(alice.getOpenInventory().getType())
        .isEqualTo(org.bukkit.event.inventory.InventoryType.CHEST);
  }

  @Test
  void twoMatchesInARowWithoutJoiningAgain() {
    var harness = start();
    var alice = harness.loadedPlayer("Alice");
    alice.performCommand("rwf kits");
    toFreeze(harness, alice);
    tickUntil(harness, PhaseKind.LIVE, 6);
    UUID first = harness.snapshot().matchId();
    var from = alice.getLocation();
    var looked = from.clone();
    looked.setYaw(from.getYaw() + 10);
    harness.server.getPluginManager().callEvent(new PlayerMoveEvent(alice, from, looked));
    var enemy = teamOf(harness, alice) == TeamColor.RED ? TeamColor.BLUE : TeamColor.RED;
    harness.tick(Duration.ofSeconds(61));
    for (var bot : harness.bots.spawned()) {
      var view = harness.snapshot().combatant(harness.bots.idOf(bot).orElseThrow());
      if (view.flatMap(MatchSnapshot.CombatantView::team).filter(enemy::equals).isPresent()) {
        bot.setHealth(0);
      }
    }
    harness.until(() -> harness.snapshot().phase() == PhaseKind.ENDED);

    for (var i = 0; i < 40 && harness.snapshot().matchId().equals(first); i++) {
      harness.tick(Duration.ofSeconds(1));
    }

    harness.until(() -> !harness.snapshot().matchId().equals(first));
    assertThat(harness.snapshot().matchId()).isNotEqualTo(first);
    assertThat(harness.inMatch(alice)).isTrue();
    assertThat(harness.combatant(alice).team()).isEmpty();
    harness.until(() -> alice.getWorld().equals(harness.lobbyWorld));
    assertThat(harness.snapshot().phase()).isIn(PhaseKind.LOBBY, PhaseKind.COUNTDOWN);

    // A whole countdown: the carried lobby counts down as soon as it opens.
    tickUntil(harness, PhaseKind.PREVIEW, 100);
    tickUntil(harness, PhaseKind.FREEZE, 11);
    tickUntil(harness, PhaseKind.LIVE, 6);
    assertThat(harness.combatant(alice).alive()).isTrue();
    assertThat(alice.getWorld()).isEqualTo(harness.rwf);
  }
}
