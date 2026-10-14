package com.shepherdjerred.thestorm.rwf.domain.killstreak;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.rwf.domain.ability.KitAttacks;
import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import java.time.Duration;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

/**
 * Pins every killstreak number, name and quirk to Red Warfare's code (KillstreakManager, StreakBase
 * and streaks/*), so a change away from the original fails here first.
 */
final class OriginalStreaksTest {

  @Test
  void theRewardsComeInTheManagersOrderAtItsCounts() {
    assertThat(Killstreak.values())
        .containsExactly(
            Killstreak.COMPASS,
            Killstreak.SUPPLY_CRATE,
            Killstreak.WOLVES,
            Killstreak.IRON_GOLEM,
            Killstreak.NAPALM);
    assertThat(List.of(Killstreak.values()).stream().map(Killstreak::kills).toList())
        .containsExactly(2, 4, 4, 8, 11);
    assertThat(Killstreak.COMPASS.earnedAt(2)).isTrue();
    assertThat(Killstreak.COMPASS.earnedAt(4)).isFalse();
    assertThat(Killstreak.NAPALM.earnedAt(11)).isTrue();
    assertThat(Killstreak.NAPALM.earnedAt(33)).isFalse();
  }

  @Test
  void eachIsAnnouncedByItsOriginalName() {
    assertThat(List.of(Killstreak.values()).stream().map(Killstreak::title).toList())
        .containsExactly(
            "a tracking compass", "supply crate", "attack dogs", "iron golem", "Napalm");
  }

  @Test
  void theItemsLookAsItemBuilderMadeThem() {
    assertThat(Killstreak.COMPASS.item()).isEqualTo("COMPASS");
    assertThat(Killstreak.COMPASS.look())
        .isEqualTo(new Killstreak.Look("Tracking Compass", "green", true, List.of(), "green"));
    assertThat(Killstreak.SUPPLY_CRATE.item()).isEqualTo("REDSTONE");
    assertThat(Killstreak.SUPPLY_CRATE.look())
        .isEqualTo(
            new Killstreak.Look(
                "Supply Crate",
                "red",
                false,
                List.of("Use this in a clear", "area to receive supplies!"),
                "gray"));
    // A title with no colour of its own was turned grey.
    assertThat(Killstreak.WOLVES.look().name()).isEqualTo("Summon attack dogs");
    assertThat(Killstreak.WOLVES.look().color()).isEqualTo("gray");
    assertThat(Killstreak.IRON_GOLEM.look().name()).isEqualTo("Summon Iron Golem");
    assertThat(Killstreak.IRON_GOLEM.look().color()).isEqualTo("gray");
    assertThat(Killstreak.NAPALM.item()).isEqualTo("TNT");
    assertThat(Killstreak.NAPALM.look())
        .isEqualTo(
            new Killstreak.Look(
                "Napalm", "dark_red", false, List.of("Use to drop napalm in", "the area!"), "red"));
  }

  @Test
  void eachFallsAsItsOriginalBlock() {
    assertThat(Killstreak.COMPASS.falling()).isEmpty();
    assertThat(Killstreak.SUPPLY_CRATE.falling()).contains("OAK_PLANKS");
    assertThat(Killstreak.WOLVES.falling()).contains("WHITE_WOOL");
    assertThat(Killstreak.IRON_GOLEM.falling()).contains("IRON_BLOCK");
    assertThat(Killstreak.NAPALM.falling()).contains("TNT");
  }

  @Test
  void anyItemOfARewardsMaterialIsThatReward() {
    assertThat(Killstreak.byItem("COMPASS")).contains(Killstreak.COMPASS);
    assertThat(Killstreak.byItem("WOLF_SPAWN_EGG")).contains(Killstreak.WOLVES);
    assertThat(Killstreak.byItem("IRON_GOLEM_SPAWN_EGG")).contains(Killstreak.IRON_GOLEM);
    assertThat(Killstreak.byItem("STONE")).isEqualTo(Optional.empty());
  }

  @Test
  void deliveryKeepsStreakBasesNumbers() {
    assertThat(Delivery.LEAST_FALL).isEqualTo(50);
    assertThat(Delivery.TARGET_FALL).isEqualTo(100);
    assertThat(Delivery.LANDING_VOLUME).isEqualTo(1F);
    assertThat(Delivery.LANDING_PITCH).isEqualTo(7F);
    assertThat(Delivery.SETTLE_STEPS).isEqualTo(10);
    // The highest block Red Warfare's server named was the air above the column.
    assertThat(Delivery.dropHeight(65, 64)).isEqualTo(164);
    assertThat(Delivery.dropHeight(120, 64)).isEqualTo(170);
  }

  @Test
  void theCrateKeepsSupplyCrateKillstreaksNumbers() {
    assertThat(Delivery.CRATE_SPACING).isEqualTo(1);
    assertThat(Delivery.TEAM_LOOTS_AFTER).isEqualTo(Duration.ofSeconds(30));
    assertThat(Delivery.ANYONE_LOOTS_AFTER).isEqualTo(Duration.ofSeconds(60));
    assertThat(Delivery.crateStatus(Duration.ZERO, Duration.ZERO)).isEqualTo("Lootable");
    assertThat(Delivery.crateStatus(Duration.ofSeconds(30), Duration.ofMillis(100)))
        .isEqualTo("Lootable in 30");
    assertThat(Delivery.crateStatus(Duration.ofSeconds(60), Duration.ofMillis(59_001)))
        .isEqualTo("Lootable in 1");
  }

  @Test
  void threeCratesInFourFaceNorth() {
    assertThat(Delivery.crateFacing(0)).isEqualTo("NORTH");
    assertThat(Delivery.crateFacing(1)).isEqualTo("NORTH");
    assertThat(Delivery.crateFacing(2)).isEqualTo("NORTH");
    assertThat(Delivery.crateFacing(3)).isEqualTo("SOUTH");
    assertThatThrownBy(() -> Delivery.crateFacing(4)).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void napalmKeepsNapalmKillstreaksNumbers() {
    assertThat(Delivery.NAPALM_REACH).isEqualTo(20);
    assertThat(Delivery.NAPALM_POWER).isEqualTo(9F);
    assertThat(Delivery.NAPALM_MAX_DAMAGE).isEqualTo(1000);
    assertThat(Delivery.NAPALM_WARNING).isEqualTo(40);
    assertThat(Delivery.NAPALM_FALL_SPEED).isEqualTo(-0.6);
    assertThat(Delivery.NAPALM_HISS_EVERY).isEqualTo(5);
    assertThat(Delivery.FIREBALL_FIRE_TICKS).isEqualTo(19);
    assertThat(Delivery.FIREBALL_REKINDLE_EVERY).isEqualTo(10);
    assertThat(Delivery.FIREBALL_STOPPED).isEqualTo(0.05);
    assertThat(Delivery.FIREBALL_PICKUP_DELAY).isEqualTo(999_999);
    assertThat(Delivery.FIREBALL_SPREAD).isEqualTo(1.5);
    assertThat(Delivery.FIREBALL_LIFT).isEqualTo(0.5);
    assertThat(Delivery.FIREBALL_STEP).isEqualTo(0.25F);
    assertThat(Delivery.FIREBALL_RING).isEqualTo(0.75F);
    assertThat(Delivery.fireTicks(0.5)).isEqualTo(95);
    assertThat(Delivery.fireTicks(19.2)).isZero();
  }

  @Test
  void fireProtectionCountsAsConditionManagerCountedIt() {
    assertThat(Delivery.fireProtected(100, 0)).isEqualTo(100);
    assertThat(Delivery.fireProtected(100, 1)).isEqualTo(15);
    assertThat(Delivery.fireProtected(100, 4)).isEqualTo(60);
    assertThat(Delivery.fireProtected(100, 6)).isEqualTo(80);
    assertThat(Delivery.fireProtected(33, 1)).isEqualTo(5);
  }

  @Test
  void napalmBurnsAsFireThroughArmour() {
    assertThat(KitAttacks.NAPALM.name()).isEqualTo("Napalm Fire");
    assertThat(KitAttacks.NAPALM.has(AttackType.Flag.FIRE)).isTrue();
    assertThat(KitAttacks.NAPALM.has(AttackType.Flag.BURN)).isTrue();
    assertThat(KitAttacks.NAPALM.has(AttackType.Flag.IGNORE_ARMOR)).isFalse();
    assertThat(KitAttacks.NAPALM.has(AttackType.Flag.NO_KNOCKBACK)).isFalse();
    assertThat(KitAttacks.NAPALM_BLAST.name()).isEqualTo("Napalm Explosion");
    assertThat(KitAttacks.NAPALM_BLAST.has(AttackType.Flag.EXPLOSION)).isTrue();
    assertThat(KitAttacks.NAPALM.deathMessage())
        .isEqualTo("%Killed% was charred to a crisp by %Killer%'s napalm");
    // Summons had no attack of their own: their blows were plain melee.
    assertThat(KitAttacks.named("Wolf")).isEmpty();
    assertThat(KitAttacks.named("Iron Golem")).isEmpty();
  }

  @Test
  void theSummonsKeepWolvesAndIronGolemKillstreaksNumbers() {
    assertThat(Delivery.WOLVES).isEqualTo(3);
    assertThat(Delivery.WOLF_HEALTH).isEqualTo(14);
    assertThat(Delivery.WOLF_BITE).isEqualTo(6);
    assertThat(Delivery.WOLF_RANGE).isEqualTo(14);
    assertThat(Delivery.WOLF_SPREAD).isEqualTo(0.4);
    assertThat(Delivery.WOLF_AHEAD).isEqualTo(3);
    assertThat(Delivery.WOLF_HEEL).isEqualTo(1.5);
    assertThat(Delivery.WOLF_LEASH).isEqualTo(16);
    assertThat(Delivery.WOLF_SPEED).isEqualTo(1);
    assertThat(Delivery.WOLF_SPRINT_SPEED).isEqualTo(1.4);
    assertThat(Delivery.SECOND_TICKS).isEqualTo(20);
    assertThat(Delivery.GOLEM_MAX_HEALTH).isEqualTo(40);
    assertThat(Delivery.GOLEM_HEALTH).isEqualTo(20);
    assertThat(Delivery.GOLEM_THROW).isEqualTo(1);
    var blows = new HashSet<Double>();
    var random = new SplittableRandom(1);
    for (var i = 0; i < 100; i++) {
      blows.add(Delivery.golemBlow(random));
    }
    assertThat(blows).containsExactlyInAnyOrder(13.0, 14.0);
  }

  @Test
  void theCompassKeepsCompassKillstreaksNumbersAndItsSinkingStray() {
    assertThat(Delivery.COMPASS_WARNING).isEqualTo(Duration.ofSeconds(30));
    assertThat(Delivery.COMPASS_MESSAGE).isEqualTo(Duration.ofSeconds(2));
    assertThat(Delivery.COMPASS_VOLUME).isEqualTo(4F);
    assertThat(Delivery.COMPASS_PITCH).isZero();
    assertThat(Delivery.COMPASS_STRAY).isEqualTo(8);
    assertThat(Delivery.HALF_SECOND_TICKS).isEqualTo(10);
    var random = new SplittableRandom(5);
    var stray = 0.0;
    for (var i = 0; i < 400; i++) {
      var next = Delivery.stray(stray, random);
      assertThat(next - stray).isIn(-1.0, 0.0);
      stray = next;
    }
    assertThat(stray).isEqualTo(-8);
  }

  @Test
  void theGolemKeepsMinecraft112sGoalNumbers() {
    assertThat(GolemAi.FOLLOW_RANGE).isEqualTo(16);
    assertThat(GolemAi.SEARCH_HEIGHT).isEqualTo(4);
    assertThat(GolemAi.SNEAK_RANGE).isEqualTo(0.8);
    assertThat(GolemAi.INVISIBLE_RANGE).isEqualTo(0.7);
    assertThat(GolemAi.LEAST_COVER).isEqualTo(0.1);
    assertThat(GolemAi.UNSEEN_TICKS).isEqualTo(60);
    assertThat(GolemAi.ATTACK_COOLDOWN).isEqualTo(20);
    assertThat(GolemAi.LANDED_COOLDOWN).isEqualTo(30);
    assertThat(GolemAi.SPEED).isEqualTo(1);
    assertThat(GolemAi.CHASE_TURN).isEqualTo(30F);
    assertThat(GolemAi.FLOAT_CHANCE).isEqualTo(0.8F);
    assertThat(GolemAi.STROLL_ONE_IN).isEqualTo(120);
    assertThat(GolemAi.STROLL_IDLE).isEqualTo(100);
    assertThat(GolemAi.STROLL_TRIES).isEqualTo(10);
    assertThat(GolemAi.STROLL_REACH).isEqualTo(10);
    assertThat(GolemAi.STROLL_HEIGHT).isEqualTo(7);
    assertThat(GolemAi.LOOK_CHANCE).isEqualTo(0.02F);
    assertThat(GolemAi.LOOK_RANGE).isEqualTo(8);
  }
}
