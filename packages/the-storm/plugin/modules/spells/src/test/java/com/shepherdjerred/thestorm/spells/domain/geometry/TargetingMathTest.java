package com.shepherdjerred.thestorm.spells.domain.geometry;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

import java.util.List;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

final class TargetingMathTest {

  private static final double EPSILON = 1.0e-9;

  @ParameterizedTest
  @CsvSource({
    "0,SOUTH",
    "44,SOUTH",
    "46,WEST",
    "90,WEST",
    "180,NORTH",
    "-180,NORTH",
    "270,EAST",
    "-90,EAST",
    "315,SOUTH",
    "720,SOUTH"
  })
  void facingFollowsMinecraftYaw(float yaw, Facing expected) {
    assertThat(Facing.fromYaw(yaw)).isEqualTo(expected);
  }

  @Test
  void leftIsAQuarterTurn() {
    assertThat(Facing.NORTH.left()).isEqualTo(Facing.WEST);
    assertThat(Facing.SOUTH.left()).isEqualTo(Facing.EAST);
    for (var facing : Facing.values()) {
      assertThat(facing.left().left().left().left()).isEqualTo(facing);
      assertThat(facing.dx() * facing.left().dx() + facing.dz() * facing.left().dz()).isZero();
    }
  }

  @Test
  void facingVectorsMatchMinecraftAngles() {
    var south = Vec3.facing(0, 0);
    var west = Vec3.facing(90, 0);
    var up = Vec3.facing(0, -90);

    assertThat(south.z()).isCloseTo(1, within(EPSILON));
    assertThat(west.x()).isCloseTo(-1, within(EPSILON));
    assertThat(up.y()).isCloseTo(1, within(EPSILON));
  }

  @Test
  void pushesPointAwayFromTheCentreWithLift() {
    var push = Knockback.away(new Vec3(0, 64, 0), new Vec3(3, 64, 4), 1.0, 0.5);

    assertThat(push.x()).isCloseTo(0.6, within(EPSILON));
    assertThat(push.z()).isCloseTo(0.8, within(EPSILON));
    assertThat(push.y()).isCloseTo(0.5, within(EPSILON));
  }

  @Test
  void aTargetOnTheCentreIsOnlyLifted() {
    assertThat(Knockback.away(Vec3.ZERO, Vec3.ZERO, 2.0, 0.3)).isEqualTo(new Vec3(0, 0.3, 0));
  }

  @Test
  void heightDifferencesDoNotChangeThePushDirection() {
    var push = Knockback.away(new Vec3(0, 60, 0), new Vec3(0, 70, 2), 1.0, 0);

    assertThat(push.z()).isCloseTo(1.0, within(EPSILON));
    assertThat(push.y()).isZero();
  }

  @Test
  void leapGoesTheWayTheCasterFaces() {
    var leap = Knockback.leap(180, 2.0, 0.8);

    assertThat(leap.z()).isCloseTo(-2.0, within(EPSILON));
    assertThat(leap.x()).isCloseTo(0, within(EPSILON));
    assertThat(leap.y()).isCloseTo(0.8, within(EPSILON));
  }

  @Test
  void behindIsOppositeTheWayTheCreatureFaces() {
    var spot = Knockback.behind(new Vec3(5, 64, 5), 0, 1.5);

    assertThat(spot.z()).isCloseTo(3.5, within(EPSILON));
    assertThat(spot.x()).isCloseTo(5, within(EPSILON));
  }

  @ParameterizedTest
  @CsvSource({
    "0,0,5,south",
    "0,0,-5,north",
    "5,0,0,east",
    "-5,0,0,west",
    "4,0,4,south-east",
    "-4,0,-4,north-west",
    "0.2,0,0.1,right here"
  })
  void compassPointsName8Directions(double x, double y, double z, String expected) {
    assertThat(Compass.point(new Vec3(x, y, z))).isEqualTo(expected);
  }

  @Test
  void compassDescriptionsIncludeDistanceAndDepth() {
    assertThat(Compass.describe(new Vec3(0, -8, 12))).isEqualTo("12 blocks south, 8 below");
    assertThat(Compass.describe(new Vec3(3, 2, 4))).isEqualTo("5 blocks south-east, 2 above");
    assertThat(Compass.describe(new Vec3(0, 0, -7))).isEqualTo("7 blocks north, level with you");
    assertThat(Compass.describe(new Vec3(0.1, -3, 0))).isEqualTo("right here, 3 below");
  }

  @ParameterizedTest
  @CsvSource({"6000,0,18000", "0,0,0", "23000,0,1000", "1000,12500,11500", "30000,0,18000"})
  void personalTimeOffsetsLandOnTheTarget(long worldTime, long target, long expected) {
    var offset = PersonalTime.offset(worldTime, target);

    assertThat(offset).isEqualTo(expected);
    assertThat(Math.floorMod(worldTime + offset, PersonalTime.DAY)).isEqualTo(target);
  }

  @Test
  void personalTimeRejectsTargetsOutsideADay() {
    assertThatThrownBy(() -> PersonalTime.offset(0, 24_000))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> PersonalTime.offset(0, -1))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void confusedMonstersEachPickAnotherTarget() {
    var monsters = List.of("zombie", "skeleton", "spider", "creeper");
    var pairs = Pairing.turnOnEachOther(monsters, new SplittableRandom(7));

    assertThat(pairs).hasSize(4);
    assertThat(pairs).extracting(Pairing.Pair::attacker).containsExactlyElementsOf(monsters);
    assertThat(pairs).allMatch(pair -> !pair.attacker().equals(pair.target()));
  }

  @Test
  void aLoneMonsterHasNobodyToFight() {
    assertThat(Pairing.turnOnEachOther(List.of("zombie"), new SplittableRandom(1))).isEmpty();
    assertThat(Pairing.turnOnEachOther(List.of(), new SplittableRandom(1))).isEmpty();
  }

  @Test
  void twoMonstersAlwaysFightEachOther() {
    for (var seed = 0; seed < 20; seed++) {
      var pairs = Pairing.turnOnEachOther(List.of("a", "b"), new SplittableRandom(seed));
      assertThat(pairs).containsExactly(new Pairing.Pair<>("a", "b"), new Pairing.Pair<>("b", "a"));
    }
  }

  @Test
  void cropsGrowWithoutPassingRipe() {
    assertThat(Growth.grow(2, 7, 2)).isEqualTo(4);
    assertThat(Growth.grow(6, 7, 2)).isEqualTo(7);
    assertThat(Growth.canGrow(7, 7)).isFalse();
    assertThat(Growth.canGrow(0, 3)).isTrue();
    assertThatThrownBy(() -> Growth.grow(-1, 7, 1)).isInstanceOf(IllegalArgumentException.class);
  }

  @ParameterizedTest
  @CsvSource({
    "true,true,0.8,true",
    "false,true,0.8,false",
    "true,false,0.8,false",
    "true,true,2.0,false",
    "true,true,0.0,false",
    "true,true,0.15,true",
    "true,true,1.0,false"
  })
  void lightningIsRealOnlyWhereRainFalls(
      boolean storm, boolean openSky, double temperature, boolean expected) {
    assertThat(StormSky.rainsOn(storm, openSky, temperature)).isEqualTo(expected);
  }
}
