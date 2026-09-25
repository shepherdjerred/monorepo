package com.shepherdjerred.thestorm.npcs.domain.geo;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

final class GeoTest {

  private static final Vec3 ORIGIN = new Vec3(0, 0, 0);

  @ParameterizedTest(name = "towards ({0}, {1}) faces yaw {2}")
  @CsvSource({"0, 1, 0", "-1, 0, 90", "0, -1, -180", "1, 0, -90", "1, 1, -45"})
  void headingUsesMinecraftYaw(double x, double z, float yaw) {
    var heading = Rotation.heading(ORIGIN, new Vec3(x, 5, z), Rotation.SOUTH);
    assertThat(heading.yaw()).isCloseTo(yaw, within(1.0e-3f));
    assertThat(heading.pitch()).isZero();
  }

  @Test
  void headingStraightUpKeepsTheFallback() {
    var fallback = new Rotation(33, 0);
    assertThat(Rotation.heading(ORIGIN, new Vec3(0, 3, 0), fallback)).isEqualTo(fallback);
  }

  @Test
  void lookingUpAndDownSetsPitch() {
    assertThat(Rotation.looking(ORIGIN, new Vec3(0, 1, 1)).pitch())
        .isCloseTo(-45f, within(1.0e-3f));
    assertThat(Rotation.looking(ORIGIN, new Vec3(0, -1, 1)).pitch())
        .isCloseTo(45f, within(1.0e-3f));
    assertThat(Rotation.looking(ORIGIN, new Vec3(0, 5, 0)).pitch())
        .isCloseTo(-90f, within(1.0e-3f));
  }

  @Test
  void yawWrapsIntoHalfOpenRange() {
    assertThat(new Rotation(180, 0).yaw()).isEqualTo(-180);
    assertThat(new Rotation(540, 0).yaw()).isEqualTo(-180);
    assertThat(new Rotation(-190, 0).yaw()).isEqualTo(170);
    assertThat(new Rotation(359, 0).yaw()).isEqualTo(-1);
  }

  @Test
  void differenceTakesTheShortWayRound() {
    assertThat(new Rotation(170, 0).differenceTo(new Rotation(-170, 0))).isEqualTo(20);
    assertThat(new Rotation(0, 10).differenceTo(new Rotation(5, 40))).isEqualTo(30);
  }

  @Test
  void rejectsBadAngles() {
    assertThatThrownBy(() -> new Rotation(0, 91)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Rotation(Float.NaN, 0))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Vec3(Double.POSITIVE_INFINITY, 0, 0))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void towardsStepsAndStopsAtTheTarget() {
    var target = new Vec3(3, 4, 0);
    assertThat(ORIGIN.towards(target, 1))
        .satisfies(step -> assertThat(step.length()).isCloseTo(1, within(1.0e-9)));
    assertThat(ORIGIN.towards(target, 10)).isEqualTo(target);
    assertThat(ORIGIN.horizontalDistance(new Vec3(3, 100, 4))).isEqualTo(5);
  }

  @Test
  void chunksRoundTowardsNegativeInfinity() {
    assertThat(ChunkKey.of("w:a", new Vec3(-0.5, 0, 15.9))).isEqualTo(new ChunkKey("w:a", -1, 0));
    assertThat(ChunkKey.of("w:a", new Vec3(-16, 0, -17))).isEqualTo(new ChunkKey("w:a", -1, -2));
    assertThat(ChunkKey.of("w:a", new Vec3(16, 0, 0))).isEqualTo(new ChunkKey("w:a", 1, 0));
  }

  @Test
  void aroundCoversEveryTouchedChunk() {
    assertThat(ChunkKey.around("w:a", new Vec3(8, 0, 8), 2))
        .containsExactly(new ChunkKey("w:a", 0, 0));
    assertThat(ChunkKey.around("w:a", new Vec3(1, 0, 1), 2))
        .containsExactlyInAnyOrder(
            new ChunkKey("w:a", -1, -1),
            new ChunkKey("w:a", -1, 0),
            new ChunkKey("w:a", 0, -1),
            new ChunkKey("w:a", 0, 0));
  }

  @Test
  void spotsNeedNamespacedWorlds() {
    assertThatThrownBy(() -> new Spot("overworld", ORIGIN, Rotation.SOUTH))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(new Spot("minecraft:the_nether", ORIGIN, Rotation.SOUTH).chunk())
        .isEqualTo(new ChunkKey("minecraft:the_nether", 0, 0));
  }
}
