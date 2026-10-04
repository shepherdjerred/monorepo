package com.shepherdjerred.thestorm.rwf;

import static java.util.Objects.requireNonNull;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.rwf.adapter.db.JooqMatchStore;
import com.shepherdjerred.thestorm.rwf.adapter.record.Retention;
import com.shepherdjerred.thestorm.rwf.app.ActionRefusal;
import com.shepherdjerred.thestorm.rwf.app.PayoutService;
import com.shepherdjerred.thestorm.rwf.app.Pseudonyms;
import com.shepherdjerred.thestorm.rwf.app.store.MatchStore;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import com.shepherdjerred.thestorm.rwf.domain.match.Outcome;
import com.shepherdjerred.thestorm.rwf.domain.record.MatchRecord;
import com.shepherdjerred.thestorm.rwf.domain.record.RecordCodec;
import com.shepherdjerred.thestorm.rwf.domain.record.RecordEnd;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Map;
import java.util.zip.GZIPInputStream;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.block.BlockFace;
import org.bukkit.entity.TNTPrimed;
import org.bukkit.event.block.Action;
import org.bukkit.event.player.PlayerInteractEvent;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

/**
 * Whole matches on MockBukkit: bots fill the countdown, a human arms a bomb through the real
 * listener and a bot defuses it through the actions port, the rules' damage replaces vanilla's, a
 * win pays through the outbox and writes a decodable recording, and a match with no humans left is
 * stopped unpaid.
 */
final class RwfMatchFlowTest {

  @TempDir Path directory;
  private @Nullable RwfHarness running;

  @AfterEach
  void stop() {
    if (running != null) {
      running.close();
    }
  }

  private RwfHarness harness() {
    return requireNonNull(running);
  }

  private RwfHarness start() {
    running = RwfHarness.start(directory);
    return running;
  }

  private TeamColor teamOf(PlayerMock player) {
    return harness().combatant(player).team().orElseThrow();
  }

  private static TeamColor enemyOf(TeamColor team) {
    return team == TeamColor.RED ? TeamColor.BLUE : TeamColor.RED;
  }

  private static String bombOf(TeamColor team) {
    return team == TeamColor.RED ? "red-1" : "blue-1";
  }

  private Location bombBlock(String bombId) {
    var site = harness().snapshot().bomb(bombId).orElseThrow().position();
    return new Location(harness().rwf, site.x(), site.y(), site.z());
  }

  /** A living bot on {@code team}, with its id. */
  private BotOn botOn(TeamColor team) {
    for (var bot : harness().bots.spawned()) {
      var view = harness().snapshot().combatant(harness().bots.idOf(bot).orElseThrow());
      if (view.isPresent()
          && view.orElseThrow().alive()
          && view.orElseThrow().team().filter(team::equals).isPresent()) {
        return new BotOn(harness().bots.idOf(bot).orElseThrow(), bot);
      }
    }
    throw new AssertionError("no living bot on " + team);
  }

  private record BotOn(CombatantId.Bot id, PlayerMock entity) {}

  @Test
  void aHumanArmsABombThroughTheListenerAndABotDefusesItThroughTheActions() {
    var harness = start();
    var alice = harness.loadedPlayer("Alice");
    harness.goLive(alice);

    assertThat(harness.bots.spawned()).hasSize(7);
    assertThat(harness.snapshot().combatants()).hasSize(8);
    assertThat(alice.getInventory().getItem(1)).isNotNull();
    assertThat(requireNonNull(alice.getInventory().getItem(1)).getType())
        .isEqualTo(Material.IRON_SWORD);
    var enemy = enemyOf(teamOf(alice));
    var bombId = bombOf(enemy);
    var block = bombBlock(bombId);
    alice.teleport(block.clone().add(1.5, 0, 0.5));
    alice.getInventory().setHeldItemSlot(0);
    var fuse = requireNonNull(alice.getInventory().getItem(0));

    // Arming alone takes nine seconds of clicks no more than 750 ms apart.
    for (var i = 0; i < 24 && !armed(bombId); i++) {
      harness
          .server
          .getPluginManager()
          .callEvent(
              new PlayerInteractEvent(
                  alice, Action.RIGHT_CLICK_BLOCK, fuse, block.getBlock(), BlockFace.UP));
      harness.tick(Duration.ofMillis(500));
    }

    assertThat(armed(bombId)).isTrue();
    assertThat(block.getBlock().getType()).isEqualTo(Material.AIR);
    assertThat(harness.rwf.getEntitiesByClass(TNTPrimed.class)).hasSize(1);

    // The owners defuse it: a bot on that team, through the actions port, within reach.
    var defuser = botOn(enemy);
    defuser.entity().teleport(block.clone().add(-1.5, 0, 0.5));
    for (var i = 0; i < 24 && armed(bombId); i++) {
      assertThat(harness.actions().clickBomb(defuser.id(), bombId)).isEmpty();
      harness.tick(Duration.ofMillis(500));
    }

    assertThat(armed(bombId)).isFalse();
    assertThat(block.getBlock().getType()).isEqualTo(Material.TNT);
    assertThat(harness.rwf.getEntitiesByClass(TNTPrimed.class)).isEmpty();
    var far = botOn(enemy);
    far.entity().teleport(new Location(harness.rwf, 31.5, 65, 31.5));
    assertThat(harness.actions().clickBomb(far.id(), bombId))
        .contains(ActionRefusal.BOMB_OUT_OF_REACH);
  }

  private boolean armed(String bombId) {
    return harness().snapshot().bomb(bombId).orElseThrow().state()
        instanceof MatchSnapshot.BombView.State.Armed;
  }

  @Test
  void theRulesDamageReplacesVanillaDamageAndTheHitWindowHolds() {
    var harness = start();
    var alice = harness.loadedPlayer("Alice");
    harness.goLive(alice);
    var attacker = botOn(enemyOf(teamOf(alice)));
    alice.teleport(new Location(harness.rwf, 31.5, 65, 20.5));
    attacker.entity().teleport(new Location(harness.rwf, 31.5, 65, 22.5));
    alice.setHealth(20);

    // The server reports a hit for its own amount; the listener cancels it and applies the rules'.
    var vanilla = alice.simulateDamage(6, attacker.entity());

    // Trooper's Sharpness I iron sword: (2 + 4 + 1.25) x (1 - 15 / 25) against full iron.
    assertThat(vanilla.isCancelled()).isTrue();
    assertThat(alice.getHealth()).isCloseTo(20 - 2.9, within(0.001));
    assertThat(alice.getNoDamageTicks()).isEqualTo(20);
    assertThat(harness.actions().melee(attacker.id(), new CombatantId.Human(alice.getUniqueId())))
        .as("inside the hit window a hit of the same strength is refused")
        .contains(ActionRefusal.HIT_WINDOW);
    var friend = botOn(teamOf(alice));
    assertThat(harness.actions().melee(friend.id(), new CombatantId.Human(alice.getUniqueId())))
        .contains(ActionRefusal.SAME_TEAM);
    var farAway = botOn(enemyOf(teamOf(alice)));
    farAway.entity().teleport(new Location(harness.rwf, 60.5, 65, 60.5));
    assertThat(harness.actions().melee(farAway.id(), new CombatantId.Human(alice.getUniqueId())))
        .contains(ActionRefusal.OUT_OF_REACH);
  }

  @Test
  void aWinPaysThroughTheOutboxWritesARecordingAndResetsTheMap() {
    var harness = start();
    var alice = harness.loadedPlayer("Alice");
    harness.goLive(alice);
    var matchId = harness.snapshot().matchId();
    var enemy = enemyOf(teamOf(alice));
    harness.tick(Duration.ofSeconds(61));

    for (var bot : harness.bots.spawned()) {
      var view = harness.snapshot().combatant(harness.bots.idOf(bot).orElseThrow()).orElseThrow();
      if (view.team().filter(enemy::equals).isPresent()) {
        bot.setHealth(0);
      }
    }
    harness.until(() -> harness.snapshot().phase() == MatchSnapshot.PhaseKind.ENDED);

    assertThat(harness.snapshot().outcome()).contains(new Outcome.Winner(teamOf(alice)));
    harness.until(() -> !harness.wallets.receipts().isEmpty());
    var receipt = harness.wallets.receipts().getFirst();
    assertThat(receipt.amount().amount()).as("3 x (0.25 + 0.75 / 8), rounded").isEqualTo(1);
    assertThat(receipt.reason()).isEqualTo(PayoutService.reason(matchId, MatchStore.Outcome.WIN));
    var store = new JooqMatchStore(harness.database);
    harness.until(
        () ->
            store.players(matchId).join().stream()
                .anyMatch(row -> row.status() == MatchStore.PayoutStatus.PAID));
    assertThat(store.players(matchId).join())
        .singleElement()
        .satisfies(
            row -> {
              assertThat(row.player()).isEqualTo(alice.getUniqueId());
              assertThat(row.outcome()).isEqualTo(MatchStore.Outcome.WIN);
              assertThat(row.creditsOwed()).isEqualTo(1);
            });

    harness.tick(Duration.ofSeconds(16));
    harness.until(() -> harness.snapshot().phase() == MatchSnapshot.PhaseKind.LOBBY);
    assertThat(harness.bots.spawned()).isEmpty();
    assertThat(alice.getWorld()).isEqualTo(harness.overworld);
    assertThat(harness.snapshot().matchId()).isNotEqualTo(matchId);

    var files = Retention.list(directory.resolve("rwf-recordings"));
    assertThat(files).hasSize(1);
    var text = decompress(files.getFirst());
    var record =
        switch (RecordCodec.decode(text)) {
          case Result.Ok<MatchRecord, RecordCodec.Problem>(var value) -> value;
          case Result.Err<MatchRecord, RecordCodec.Problem>(var problem) ->
              throw new AssertionError(problem);
        };
    var pseudonym = new Pseudonyms(RwfHarness.SALT).of(alice.getUniqueId());
    assertThat(record.header().matchId()).isEqualTo(matchId);
    assertThat(record.header().roster()).hasSize(8);
    assertThat(record.header().roster()).filteredOn(entry -> !entry.bot()).hasSize(1);
    assertThat(record.end().reason()).isEqualTo(RecordEnd.Reason.LAST_TEAM_STANDING);
    assertThat(record.end().payouts()).containsEntry(pseudonym, 1L);
    assertThat(record.frames()).isNotEmpty();
    assertThat(record.events()).anyMatch(event -> event.kind().equals("died"));
    assertThat(text).doesNotContain("Alice").doesNotContain(alice.getUniqueId().toString());
  }

  @Test
  void aDeadMemberWatchesFromTheSpectatorPointAfterRespawning() {
    var harness = start();
    var alice = harness.loadedPlayer("Alice");
    harness.goLive(alice);
    var victim = botOn(enemyOf(teamOf(alice)));

    victim.entity().setHealth(0);
    harness.until(() -> !harness.snapshot().combatant(victim.id()).orElseThrow().alive());
    victim.entity().respawn();
    harness.until(() -> victim.entity().getGameMode() == GameMode.SPECTATOR);

    assertThat(victim.entity().getLocation().getY()).isEqualTo(76);
    assertThat(harness.snapshot().phase()).isEqualTo(MatchSnapshot.PhaseKind.LIVE);
  }

  @Test
  void aLiveMatchWithNoHumansLeftIsStoppedUnpaidAndBotsLeave() {
    var harness = start();
    var alice = harness.loadedPlayer("Alice");
    harness.goLive(alice);
    var matchId = harness.snapshot().matchId();

    alice.performCommand("rwf leave");
    assertThat(alice.getWorld()).isEqualTo(harness.overworld);
    assertThat(harness.snapshot().phase()).isEqualTo(MatchSnapshot.PhaseKind.LIVE);
    // The abort clock starts at the first tick without humans.
    harness.ticks(1);
    harness.tick(Duration.ofSeconds(29));
    assertThat(harness.snapshot().phase()).isEqualTo(MatchSnapshot.PhaseKind.LIVE);
    harness.tick(Duration.ofSeconds(2));
    harness.until(() -> harness.snapshot().phase() == MatchSnapshot.PhaseKind.LOBBY);

    assertThat(harness.bots.spawned()).isEmpty();
    assertThat(harness.wallets.receipts()).isEmpty();
    var store = new JooqMatchStore(harness.database);
    harness.until(() -> !store.players(matchId).join().isEmpty());
    assertThat(store.players(matchId).join())
        .singleElement()
        .satisfies(
            row -> {
              assertThat(row.outcome()).isEqualTo(MatchStore.Outcome.STOPPED);
              assertThat(row.status()).isEqualTo(MatchStore.PayoutStatus.NONE);
            });
    assertThat(store.unpaid().join()).isEmpty();
  }

  @Test
  void botsNeverKeepACountdownAliveWithoutHumans() {
    var harness = start();
    var alice = harness.loadedPlayer("Alice");
    harness.enter(alice);
    harness.until(() -> harness.snapshot().phase() == MatchSnapshot.PhaseKind.COUNTDOWN);
    assertThat(harness.bots.spawned()).hasSize(7);

    alice.performCommand("rwf leave");
    harness.ticks(2);

    assertThat(harness.snapshot().phase()).isEqualTo(MatchSnapshot.PhaseKind.LOBBY);
    assertThat(harness.snapshot().combatants()).isEmpty();
    assertThat(harness.bots.spawned()).isEmpty();
  }

  @Test
  void matchesRunHumansOnlyWithoutABotRoster() {
    running = RwfHarness.prepare(directory).enable(directory, false, Map.of());
    var harness = harness();
    var alice = harness.loadedPlayer("Alice");
    harness.enter(alice);
    harness.until(() -> harness.snapshot().phase() == MatchSnapshot.PhaseKind.COUNTDOWN);

    assertThat(harness.snapshot().combatants()).hasSize(1);
    harness.server.dispatchCommand(harness.server.getConsoleSender(), "rwf admin status");
    harness.server.dispatchCommand(harness.server.getConsoleSender(), "rwf who");
  }

  @Test
  void theRewindClockSendsAPlayerBackAlongTheirTrail() {
    var harness = start();
    var alice = harness.loadedPlayer("Alice");
    harness.enter(alice);
    alice.performCommand("rwf kit rewind");
    harness.until(() -> harness.snapshot().phase() == MatchSnapshot.PhaseKind.COUNTDOWN);
    harness.tick(Duration.ofSeconds(91));
    harness.until(() -> harness.snapshot().phase() == MatchSnapshot.PhaseKind.LIVE);
    var id = new CombatantId.Human(alice.getUniqueId());
    assertThat(harness.actions().useRewind(id))
        .as("on cooldown as the match starts")
        .contains(ActionRefusal.COOLING_DOWN);
    var origin = new Location(harness.rwf, 31.5, 65, 20.5);
    alice.teleport(origin);
    harness.ticks(10);
    harness.tick(Duration.ofSeconds(31));
    alice.teleport(new Location(harness.rwf, 31.5, 65, 40.5));
    harness.ticks(10);

    assertThat(harness.actions().useRewind(id)).isEmpty();

    assertThat(alice.getLocation().getZ()).isEqualTo(20.5);
    assertThat(alice.getLocation().getX()).isEqualTo(31.5);
    assertThat(harness.actions().useRewind(id)).contains(ActionRefusal.COOLING_DOWN);
  }

  private static String decompress(Path file) {
    try (var in = new GZIPInputStream(Files.newInputStream(file))) {
      return new String(in.readAllBytes(), StandardCharsets.UTF_8);
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }
}
