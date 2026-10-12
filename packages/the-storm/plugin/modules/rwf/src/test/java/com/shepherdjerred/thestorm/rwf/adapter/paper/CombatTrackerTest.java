package com.shepherdjerred.thestorm.rwf.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.testing.FakeClock;
import com.shepherdjerred.thestorm.rwf.testing.Samples;
import java.time.Duration;
import java.util.Optional;
import java.util.UUID;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.WorldCreator;
import org.bukkit.util.Vector;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;
import org.mockbukkit.mockbukkit.world.WorldMock;

/** Death attribution as Red Warfare's "Fall" condition and combat log kept it (MockBukkit). */
final class CombatTrackerTest {

  private static final UUID PUSHER = UUID.fromString("00000000-0000-0000-0000-0000000000aa");

  private final FakeClock clock = new FakeClock(Samples.T0);
  private final CombatTracker tracker = new CombatTracker(clock);
  private PlayerMock victim;
  private WorldMock world;

  @BeforeEach
  void start() {
    ServerMock server = MockBukkit.mock();
    world = new WorldMock(new WorldCreator("rwf"));
    server.addWorld(world);
    world.getBlockAt(0, 63, 0).setType(Material.STONE);
    victim = server.addPlayer("Victim");
    victim.teleport(new Location(world, 0.5, 64, 0.5));
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  private void airborne() {
    victim.teleport(new Location(world, 0.5, 80, 0.5));
  }

  @Test
  void worldDamageAfterAKnockDoesNotTakeTheVoidFromTheKnocker() {
    tracker.hit(victim, 3, Optional.of(PUSHER), AttackType.PROJECTILE);
    airborne();
    clock.advance(Duration.ofSeconds(2));
    tracker.tick(victim, false);
    tracker.hurt(victim, AttackType.BORDER, 2);
    tracker.hurt(victim, AttackType.FIRE_TICK, 1);

    tracker.intoVoid(victim.getUniqueId());

    var last = tracker.last(victim.getUniqueId()).orElseThrow();
    assertThat(last.cause()).isEqualTo(AttackType.VOID_SHOT);
    assertThat(last.attacker()).contains(PUSHER);
  }

  @Test
  void aFallWhileKnockedIsTheKnockersAndASettledFighterFallsAlone() {
    tracker.hit(victim, 3, Optional.of(PUSHER), AttackType.MELEE);
    tracker.hurt(victim, AttackType.FALL, 4);
    assertThat(tracker.last(victim.getUniqueId()).orElseThrow().cause())
        .isEqualTo(AttackType.FALL_PUSHED);

    // Back on the ground and still for over half a second: the knock has ended.
    victim.setVelocity(new Vector());
    victim.setFallDistance(0);
    clock.advance(Duration.ofMillis(600));
    tracker.tick(victim, true);
    tracker.hurt(victim, AttackType.FALL, 4);

    var last = tracker.last(victim.getUniqueId()).orElseThrow();
    assertThat(last.cause()).isEqualTo(AttackType.FALL);
    assertThat(last.attacker()).isEmpty();
  }

  @Test
  void theKnockEndsAfterTenSecondsInTheAirAndOnTheTimeMachine() {
    tracker.hit(victim, 3, Optional.of(PUSHER), AttackType.MELEE);
    airborne();
    clock.advance(Duration.ofMillis(10_001));
    tracker.tick(victim, false);
    tracker.intoVoid(victim.getUniqueId());
    assertThat(tracker.last(victim.getUniqueId()).orElseThrow().cause()).isEqualTo(AttackType.VOID);

    tracker.hit(victim, 3, Optional.of(PUSHER), AttackType.MELEE);
    tracker.clearFallCredit(victim.getUniqueId());
    tracker.intoVoid(victim.getUniqueId());
    assertThat(tracker.last(victim.getUniqueId()).orElseThrow().attacker()).isEmpty();
  }

  @Test
  void aHitTheVictimHealedFromLeavesTheLogEvenIfTheyAreHurtAgain() {
    tracker.hit(victim, 3, Optional.of(PUSHER), AttackType.MELEE);
    victim.setHealth(20);
    clock.advance(Duration.ofSeconds(11));

    // New damage is logged while healed and grounded: the old hit is dropped for good.
    tracker.hurt(victim, AttackType.BORDER, 2);
    victim.setHealth(18);

    assertThat(tracker.credit(victim)).isEmpty();
  }

  @Test
  void anUnhealedHitStillEarnsTheRulesKill() {
    tracker.hit(victim, 3, Optional.of(PUSHER), AttackType.MELEE);
    victim.setHealth(17);
    clock.advance(Duration.ofMinutes(2));

    assertThat(tracker.credit(victim)).map(CombatTracker.Credit::attacker).contains(PUSHER);
  }
}
