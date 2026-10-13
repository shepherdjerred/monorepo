package com.shepherdjerred.thestorm.rwf.domain.killstreak;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.offset;

import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import java.util.List;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

/** The killstreak golem's port of Red Warfare's PathfinderSelector and Minecraft 1.12's goals. */
final class GolemAiTest {

  private static final Vec3 FEET = new Vec3(0, 64, 0);
  private static final double EYES = 2.2;

  /** A visible, unhurried enemy player at {@code pos}. */
  private static GolemAi.Sighting<String> player(String who, Vec3 pos) {
    return new GolemAi.Sighting<>(
        who, pos, true, true, false, false, false, false, false, false, 1, true);
  }

  private static GolemAi.Sighting<String> mob(String who, Vec3 pos) {
    return new GolemAi.Sighting<>(
        who, pos, false, true, false, false, false, false, false, false, 0, false);
  }

  /** A way a sighting differs from the plain one. */
  private enum Trait {
    DEAD,
    ALLY,
    HIDDEN,
    UNTOUCHABLE
  }

  private static GolemAi.Sighting<String> with(GolemAi.Sighting<String> s, Trait trait) {
    return new GolemAi.Sighting<>(
        s.who(),
        s.pos(),
        s.player(),
        trait != Trait.DEAD && s.alive(),
        trait == Trait.ALLY || s.ally(),
        trait == Trait.HIDDEN || s.hidden(),
        s.creeper(),
        trait == Trait.UNTOUCHABLE || s.untouchable(),
        s.sneaking(),
        s.invisible(),
        s.armorCover(),
        s.seen());
  }

  @Test
  void theSelectorSparesTeammatePlayersAndHiddenGhostsButNotTheTeamsSummons() {
    var enemy = player("enemy", FEET);
    assertThat(GolemAi.selects(enemy)).isTrue();
    assertThat(GolemAi.selects(with(enemy, Trait.DEAD))).isFalse();
    assertThat(GolemAi.selects(with(enemy, Trait.ALLY))).isFalse();
    assertThat(GolemAi.selects(with(enemy, Trait.HIDDEN))).isFalse();
    var ownWolf = with(mob("wolf", FEET), Trait.ALLY);
    assertThat(GolemAi.selects(ownWolf)).isTrue();
  }

  @Test
  void aGhostIsHiddenOnlyWhileStillEmptyHandedAndArrowless() {
    assertThat(GolemAi.hidden(true, false, false, 0)).isTrue();
    assertThat(GolemAi.hidden(true, true, false, 0)).isFalse();
    assertThat(GolemAi.hidden(true, false, true, 0)).isFalse();
    assertThat(GolemAi.hidden(true, false, false, 1)).isFalse();
    assertThat(GolemAi.hidden(false, false, false, 0)).isFalse();
  }

  @Test
  void suitabilityRefusesCreepersCreativePlayersAndUnseenPlayers() {
    var creeper =
        new GolemAi.Sighting<>(
            "creeper", FEET, false, true, false, false, true, false, false, false, 0, true);
    assertThat(GolemAi.suitable(creeper, false)).isFalse();
    assertThat(GolemAi.suitable(with(player("p", FEET), Trait.UNTOUCHABLE), true)).isFalse();
    var unseen = mob("zombie", FEET);
    assertThat(GolemAi.suitable(unseen, true)).isFalse();
    assertThat(GolemAi.suitable(unseen, false)).isTrue();
  }

  @Test
  void theNearestSeenPlayerWithinSixteenAcrossIsTaken() {
    var far = player("far", new Vec3(15.9, 64, 0));
    var near = player("near", new Vec3(4, 64, 0));
    var outside = player("outside", new Vec3(16.1, 64, 0));
    assertThat(GolemAi.nearestPlayer(FEET, EYES, List.of(far, near, outside)))
        .map(GolemAi.Sighting::who)
        .contains("near");
    assertThat(GolemAi.nearestPlayer(FEET, EYES, List.of(outside))).isEmpty();
  }

  @Test
  void anyoneWithinTwoHundredFiftySixUpOrDownCounts() {
    var above = player("above", new Vec3(1, 64 + EYES + 255, 0));
    var tooHigh = player("tooHigh", new Vec3(1, 64 + EYES + 256, 0));
    assertThat(GolemAi.nearestPlayer(FEET, EYES, List.of(above))).isPresent();
    assertThat(GolemAi.nearestPlayer(FEET, EYES, List.of(tooHigh))).isEmpty();
  }

  @Test
  void sneakingAndInvisiblePlayersAreFoundCloser() {
    var sneaking =
        new GolemAi.Sighting<>(
            "s", new Vec3(13, 64, 0), true, true, false, false, false, false, true, false, 1, true);
    assertThat(GolemAi.nearestPlayer(FEET, EYES, List.of(sneaking))).isEmpty();
    var bareGhost =
        new GolemAi.Sighting<>(
            "g",
            new Vec3(1.2, 64, 0),
            true,
            true,
            false,
            false,
            false,
            false,
            false,
            true,
            0,
            true);
    var closeGhost =
        new GolemAi.Sighting<>(
            "g",
            new Vec3(1.1, 64, 0),
            true,
            true,
            false,
            false,
            false,
            false,
            false,
            true,
            0,
            true);
    // 16 x 0.7 x 0.1 = 1.12 blocks for an invisible player without armour.
    assertThat(GolemAi.nearestPlayer(FEET, EYES, List.of(bareGhost))).isEmpty();
    assertThat(GolemAi.nearestPlayer(FEET, EYES, List.of(closeGhost))).isPresent();
  }

  @Test
  void theFirstOfEquallyNearPlayersWins() {
    var first = player("first", new Vec3(3, 64, 0));
    var second = player("second", new Vec3(0, 64, 3));
    assertThat(GolemAi.nearestPlayer(FEET, EYES, List.of(first, second)))
        .map(GolemAi.Sighting::who)
        .contains("first");
  }

  @Test
  void theNearestMobIsTakenSeenOrNot() {
    var near = mob("near", new Vec3(2, 66, 0));
    var far = mob("far", new Vec3(9, 64, 0));
    var creeper =
        new GolemAi.Sighting<>(
            "creeper",
            new Vec3(1, 64, 0),
            false,
            true,
            false,
            false,
            true,
            false,
            false,
            false,
            0,
            false);
    assertThat(GolemAi.nearestMob(FEET, List.of(far, creeper, near)))
        .map(GolemAi.Sighting::who)
        .contains("near");
    assertThat(GolemAi.nearestMob(FEET, List.of(creeper))).isEmpty();
  }

  @Test
  void aTargetIsKeptWhileNearAliveAndForAPlayerSeen() {
    assertThat(GolemAi.keeps(player("p", new Vec3(16, 64, 0)), FEET)).isTrue();
    assertThat(GolemAi.keeps(player("p", new Vec3(16.01, 64, 0)), FEET)).isFalse();
    assertThat(GolemAi.keeps(with(player("p", FEET), Trait.UNTOUCHABLE), FEET)).isFalse();
    assertThat(GolemAi.keeps(with(player("p", FEET), Trait.DEAD), FEET)).isFalse();
    var unseen = 0;
    for (var i = 0; i < GolemAi.UNSEEN_TICKS; i++) {
      unseen = GolemAi.unseen(unseen, false);
    }
    assertThat(unseen).isEqualTo(60);
    assertThat(GolemAi.unseen(unseen, false)).isGreaterThan(GolemAi.UNSEEN_TICKS);
    assertThat(GolemAi.unseen(unseen, true)).isZero();
  }

  @Test
  void theGolemReachesItsWidthDoubledSquaredPlusTheTargets() {
    assertThat(GolemAi.reach(1.4, 0.6)).isCloseTo(8.44, offset(1e-9));
  }

  @Test
  void aChasePathsAgainEveryFourToTenTicksWhileTheTargetIsSeen() {
    var random = new SplittableRandom(3);
    var target = new GolemAi.Target(new Vec3(5, 64, 0), 25, 8.44);
    var first = GolemAi.chase(GolemAi.Chase.START, target, true, random);
    assertThat(first.repath()).isTrue();
    assertThat(first.next().delay()).isBetween(4, 10);
    assertThat(first.next().pathedTo()).contains(new Vec3(5, 64, 0));
    assertThat(first.swing()).isFalse();
    var unseen = GolemAi.chase(GolemAi.Chase.START, target, false, random);
    assertThat(unseen.repath()).isFalse();
    var far =
        GolemAi.chase(GolemAi.Chase.START, new GolemAi.Target(FEET, 1025, 8.44), true, random);
    assertThat(far.next().delay()).isBetween(14, 20);
    var middling =
        GolemAi.chase(GolemAi.Chase.START, new GolemAi.Target(FEET, 300, 8.44), true, random);
    assertThat(middling.next().delay()).isBetween(9, 15);
    assertThat(first.next().unreachable().delay()).isEqualTo(first.next().delay() + 15);
  }

  @Test
  void aSwingWaitsTwentyTicksOrThirtyAfterABlowLands() {
    var random = new SplittableRandom(4);
    var inReach = new GolemAi.Target(new Vec3(1, 64, 0), 1, 8.44);
    var swing = GolemAi.chase(GolemAi.Chase.START, inReach, true, random);
    assertThat(swing.swing()).isTrue();
    assertThat(swing.next().cooldown()).isEqualTo(GolemAi.ATTACK_COOLDOWN);
    assertThat(swing.next().landed().cooldown()).isEqualTo(GolemAi.LANDED_COOLDOWN);
    var chase = swing.next().landed();
    var swings = 0;
    for (var i = 0; i < GolemAi.LANDED_COOLDOWN; i++) {
      var step = GolemAi.chase(chase, inReach, true, random);
      chase = step.next();
      swings += step.swing() ? 1 : 0;
    }
    assertThat(swings).isEqualTo(1);
    var outOfReach = new GolemAi.Target(new Vec3(4, 64, 0), 16, 8.44);
    assertThat(GolemAi.chase(GolemAi.Chase.START, outOfReach, true, random).swing()).isFalse();
  }

  @Test
  void aStrollTriesTenSpotsWithinTenAcrossAndSevenUpOrDown() {
    var random = new SplittableRandom(8);
    var spots = GolemAi.strollSpots(random);
    assertThat(spots).hasSize(10);
    for (var spot : spots) {
      assertThat(spot[0]).isBetween(-10, 10);
      assertThat(spot[1]).isBetween(-7, 7);
      assertThat(spot[2]).isBetween(-10, 10);
    }
    var strolls = 0;
    for (var i = 0; i < 12_000; i++) {
      strolls += GolemAi.strolls(0, random) ? 1 : 0;
    }
    assertThat(strolls).isBetween(60, 140);
    assertThat(GolemAi.strolls(GolemAi.STROLL_IDLE, new SplittableRandom(1))).isFalse();
  }

  @Test
  void looksLastAsMinecraftTimedThem() {
    var random = new SplittableRandom(2);
    for (var i = 0; i < 200; i++) {
      assertThat(GolemAi.lookTicks(random)).isBetween(40, 79);
      assertThat(GolemAi.glanceTicks(random)).isBetween(20, 39);
    }
    var swims = 0;
    var glances = 0;
    for (var i = 0; i < 10_000; i++) {
      swims += GolemAi.swims(random) ? 1 : 0;
      glances += GolemAi.glances(random) ? 1 : 0;
    }
    assertThat(swims).isBetween(7_700, 8_300);
    assertThat(glances).isBetween(130, 270);
  }
}
