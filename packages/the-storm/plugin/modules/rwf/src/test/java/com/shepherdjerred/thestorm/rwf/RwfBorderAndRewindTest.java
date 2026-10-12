package com.shepherdjerred.thestorm.rwf;

import static java.util.Objects.requireNonNull;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import com.shepherdjerred.thestorm.rwf.adapter.db.JooqMatchStore;
import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEvent;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.bukkit.Location;
import org.bukkit.util.Vector;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

/**
 * Red Warfare's square border (columns only, two damage a second outside), the void below a map,
 * the kill credit for a bomb death, and the Time Machine's landing, on MockBukkit with the training
 * yard (region x 0-63, y 64-79, z 0-63; its floor is at y 64).
 */
final class RwfBorderAndRewindTest {

  @TempDir Path directory;
  private @Nullable RwfHarness running;

  @AfterEach
  void stop() {
    if (running != null) {
      running.close();
    }
  }

  private RwfHarness live(PlayerMock[] alice) {
    running = RwfHarness.start(directory);
    alice[0] = running.loadedPlayer("Alice");
    running.goLive(alice[0]);
    return running;
  }

  private static TeamColor enemyOf(TeamColor team) {
    return team == TeamColor.RED ? TeamColor.BLUE : TeamColor.RED;
  }

  private record BotOn(CombatantId.Bot id, PlayerMock entity) {}

  private BotOn botOn(RwfHarness harness, TeamColor team) {
    for (var bot : harness.bots.spawned()) {
      var id = harness.bots.idOf(bot).orElseThrow();
      var view = harness.snapshot().combatant(id);
      if (view.isPresent()
          && view.orElseThrow().alive()
          && view.orElseThrow().team().filter(team::equals).isPresent()) {
        return new BotOn(id, bot);
      }
    }
    throw new AssertionError("no living bot on " + team);
  }

  private static List<MatchEvent.Died> deaths(RwfHarness harness) {
    var deaths = new ArrayList<MatchEvent.Died>();
    var _ =
        harness
            .events()
            .subscribe(
                notification -> {
                  if (notification.event() instanceof MatchEvent.Died died) {
                    deaths.add(died);
                  }
                });
    return deaths;
  }

  @Test
  void outsideTheBorderHurtsTwoASecondButClimbingAboveTheMapDoesNot() {
    var alice = new PlayerMock[1];
    var harness = live(alice);
    var player = alice[0];
    player.teleport(new Location(harness.rwf, 31.5, 150, 20.5));
    var high = player.getHealth();
    harness.ticks(40);
    assertThat(player.getHealth()).as("above the map, inside the columns").isEqualTo(high);
    assertThat(harness.combatant(player).alive()).isTrue();

    player.teleport(new Location(harness.rwf, 70.5, 65, 20.5));
    RwfHarness.messages(player);
    var before = player.getHealth();
    harness.ticks(20);

    assertThat(player.getHealth()).isCloseTo(before - 2, within(1e-9));
    assertThat(player.getLocation().getX()).as("not teleported back").isEqualTo(70.5);
    assertThat(RwfHarness.messages(player))
        .anyMatch(message -> message.endsWith("You cannot explore the border!"));
    harness.ticks(20);
    assertThat(player.getHealth()).isCloseTo(before - 4, within(1e-9));
  }

  @Test
  void fallingBelowTheMapIsAVoidDeathCreditedToWhoeverKnockedThem() {
    var alice = new PlayerMock[1];
    var harness = live(alice);
    var player = alice[0];
    var deaths = deaths(harness);
    var team = harness.combatant(player).team().orElseThrow();
    var pusher = botOn(harness, enemyOf(team));
    player.teleport(new Location(harness.rwf, 31.5, 65, 20.5));
    pusher.entity().teleport(new Location(harness.rwf, 31.5, 65, 22.5));
    player.setNoDamageTicks(0);
    player.simulateDamage(1, pusher.entity());
    harness.ticks(1);

    // Still above the void line (eight blocks under the floor at 64).
    player.teleport(new Location(harness.rwf, 31.5, 57, 20.5));
    harness.ticks(1);
    assertThat(harness.combatant(player).alive()).isTrue();

    player.teleport(new Location(harness.rwf, 31.5, 55, 20.5));
    harness.ticks(1);

    assertThat(harness.combatant(player).alive()).isFalse();
    assertThat(deaths)
        .singleElement()
        .satisfies(
            died -> {
              assertThat(died.cause()).isEqualTo(AttackType.VOID_PUSHED);
              assertThat(died.killer()).contains(pusher.id());
            });
  }

  @Test
  void aBombDeathIsCreditedToTheLastMemberWhoHurtTheVictim() {
    var alice = new PlayerMock[1];
    var harness = live(alice);
    var player = alice[0];
    var matchId = harness.snapshot().matchId();
    var enemy = enemyOf(harness.combatant(player).team().orElseThrow());
    var victim = botOn(harness, enemy);
    victim.entity().teleport(new Location(harness.rwf, 31.5, 65, 22.5));
    player.teleport(new Location(harness.rwf, 31.5, 65, 20.5));
    victim.entity().setNoDamageTicks(0);
    victim.entity().simulateDamage(3, player);
    assertThat(victim.entity().getHealth()).isLessThan(20);

    // Alice arms the enemy bomb; when it goes off it takes her whole enemy team with it.
    var bombId = enemy == TeamColor.RED ? "red-1" : "blue-1";
    var site = harness.snapshot().bomb(bombId).orElseThrow().position();
    player.teleport(new Location(harness.rwf, site.x() + 1.5, site.y(), site.z() + 0.5));
    var aliceId = new CombatantId.Human(player.getUniqueId());
    for (var i = 0; i < 24 && !armed(harness, bombId); i++) {
      assertThat(harness.actions().clickBomb(aliceId, bombId)).isEmpty();
      harness.tick(Duration.ofMillis(500));
    }
    assertThat(armed(harness, bombId)).isTrue();
    for (var i = 0; i < 62 && harness.snapshot().phase() != MatchSnapshot.PhaseKind.ENDED; i++) {
      harness.tick(Duration.ofSeconds(1));
    }

    harness.until(() -> harness.snapshot().phase() == MatchSnapshot.PhaseKind.ENDED);
    var store = new JooqMatchStore(harness.database);
    harness.until(() -> !store.players(matchId).join().isEmpty());
    assertThat(store.players(matchId).join())
        .singleElement()
        .satisfies(row -> assertThat(row.kills()).as("only the bot she hurt").isEqualTo(1));
  }

  private static boolean armed(RwfHarness harness, String bombId) {
    return harness.snapshot().bomb(bombId).orElseThrow().state()
        instanceof MatchSnapshot.BombView.State.Armed;
  }

  @Test
  void theTimeMachineLandsFacingTheWayThePlayerFacedAndStopsThem() {
    running = RwfHarness.start(directory);
    var harness = running;
    var player = harness.loadedPlayer("Alice");
    harness.enter(player);
    player.performCommand("rwf kit rewind");
    harness.until(() -> harness.snapshot().phase() == MatchSnapshot.PhaseKind.COUNTDOWN);
    harness.tick(Duration.ofSeconds(91));
    harness.until(() -> harness.snapshot().phase() == MatchSnapshot.PhaseKind.LIVE);
    var id = new CombatantId.Human(player.getUniqueId());
    harness.ticks(1);
    assertThat(player.getExp()).as("on cooldown as the match starts").isLessThan(0.1f);

    player.teleport(new Location(harness.rwf, 31.5, 65, 20.5, 135, -20));
    harness.ticks(10);
    harness.tick(Duration.ofSeconds(31));
    assertThat(player.getExp()).as("recharged").isEqualTo(1f);
    player.teleport(new Location(harness.rwf, 31.5, 65, 40.5, 10, 5));
    harness.ticks(10);
    player.setVelocity(new Vector(0, 1, 0));
    player.setFireTicks(100);
    RwfHarness.messages(player);

    assertThat(harness.actions().useRewind(id)).isEmpty();

    var at = player.getLocation();
    assertThat(at.getZ()).isEqualTo(20.5);
    assertThat(at.getYaw()).isEqualTo(135);
    assertThat(at.getPitch()).isEqualTo(-20);
    assertThat(player.getVelocity().lengthSquared()).isZero();
    assertThat(player.getFireTicks()).isZero();
    assertThat(RwfHarness.messages(player))
        .anyMatch(message -> message.endsWith("You step sideways into the river of time.."));
    harness.ticks(1);
    assertThat(player.getExp()).isLessThan(0.1f);
  }

  @Test
  void theTrailSkipsSpotsNextToAPressurePlate() {
    running = RwfHarness.start(directory);
    var harness = running;
    var player = harness.loadedPlayer("Alice");
    harness.enter(player);
    player.performCommand("rwf kit rewind");
    harness.until(() -> harness.snapshot().phase() == MatchSnapshot.PhaseKind.COUNTDOWN);
    harness.tick(Duration.ofSeconds(91));
    harness.until(() -> harness.snapshot().phase() == MatchSnapshot.PhaseKind.LIVE);
    var id = new CombatantId.Human(player.getUniqueId());
    harness.rwf.getBlockAt(32, 65, 10).setType(org.bukkit.Material.STONE_PRESSURE_PLATE);

    player.teleport(new Location(harness.rwf, 31.5, 65, 10.5));
    harness.ticks(10);
    player.teleport(new Location(harness.rwf, 31.5, 65, 20.5));
    harness.ticks(10);
    harness.tick(Duration.ofSeconds(31));
    player.teleport(new Location(harness.rwf, 31.5, 65, 40.5));
    harness.ticks(10);

    assertThat(harness.actions().useRewind(id)).isEmpty();
    assertThat(requireNonNull(player.getLocation()).getZ()).isEqualTo(20.5);
  }
}
