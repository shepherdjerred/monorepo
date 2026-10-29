package com.shepherdjerred.thestorm.rwfbots.sim;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import com.shepherdjerred.thestorm.rwfbots.domain.Fixtures;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.BlockClassification;
import com.shepherdjerred.thestorm.rwfbots.domain.map.BlockShape;
import com.shepherdjerred.thestorm.rwfbots.domain.map.GridBounds;
import com.shepherdjerred.thestorm.rwfbots.domain.map.MapBaker;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavSites;
import com.shepherdjerred.thestorm.rwfbots.domain.map.StairQuarters;
import com.shepherdjerred.thestorm.rwfbots.domain.map.SyntheticMap;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.MovementMotor;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TraversalState;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

final class SimPhysicsTest {
  private static final Vec3 EAST = new Vec3(1, 0, 0);
  private static final NavArtifact FLAT = SyntheticMap.bake();

  private static SimBody body(Vec3 position) {
    return new SimBody(new SimWorld.Spawn(1, Fixtures.RED, Kit.TROOPER, position));
  }

  private static void move(SimPhysics physics, SimBody body, long tick) {
    body.previousPos = body.pos;
    physics.move(body, tick);
  }

  // Floor at y 0. From x 3 east, a bottom-slab floor (row z 1); a stair entered by its lower half
  // and then full blocks level with its top (row z 3); full blocks (row z 5).
  private static final BlockClassification STEPS =
      new BlockClassification() {
        @Override
        public GridBounds bounds() {
          return new GridBounds(new BlockPos(0, 0, 0), 9, 5, 7);
        }

        @Override
        public BlockShape shape(int x, int y, int z) {
          if (y == 0) return BlockShape.FULL;
          if (x < 3 || y != 1) return BlockShape.PASSABLE;
          if (z == 1) return BlockShape.SLAB_BOTTOM;
          if (z == 3) return x == 3 ? BlockShape.STAIRS : BlockShape.FULL;
          return z == 5 ? BlockShape.FULL : BlockShape.PASSABLE;
        }

        @Override
        public boolean blocksSight(int x, int y, int z) {
          return shape(x, y, z).blocksMovement();
        }

        @Override
        public int halfStepQuarters(int x, int y, int z) {
          return shape(x, y, z) == BlockShape.STAIRS
              ? StairQuarters.halfStep(StairQuarters.Facing.EAST, StairQuarters.Shape.STRAIGHT)
              : 0;
        }
      };

  @Test
  void aWalkStepsUpASlabAndAStairTheGraphWalksButNotABlockItJumps() {
    var physics = new SimPhysics(MapBaker.bake("steps", STEPS, new NavSites(List.of(), List.of())));
    assertThat(walkEast(physics, 1)).as("onto the slabs").isEqualTo(1.5);
    assertThat(walkEast(physics, 3)).as("up the stair").isEqualTo(2);
    assertThat(walkEast(physics, 5)).as("into the wall").isEqualTo(1);
  }

  /** The feet height a body walking east along row {@code z} ends at. */
  private static double walkEast(SimPhysics physics, int z) {
    var body = body(new Vec3(1.5, 1, z + 0.5));
    for (var tick = 1; tick <= 30; tick++) {
      physics.steer(body, EAST);
      move(physics, body, tick);
    }
    return body.pos.y();
  }

  @Test
  void simWorldActuallyExecutesJumpCommandsWithoutRequiringAHorizontalMoveTarget() {
    var world = new SimWorld(FLAT, 7);
    var body =
        world.addScripted(new SimWorld.Spawn(1, Fixtures.RED, Kit.TROOPER, new Vec3(4.5, 1, 6.5)));
    world.apply(body, new BodyCommand.Jump());
    world.step();
    assertThat(body.onGround).isFalse();
    assertThat(body.pos.y()).isCloseTo(1.42, within(1e-9));
    world.run(20, _ -> false);
    assertThat(body.onGround).isTrue();
    assertThat(body.pos.y()).isEqualTo(1);
  }

  @Test
  void calibratedSprintJumpActuallyLeavesGroundAndReturnsWithCapturedDisplacementVelocity() {
    var physics = new SimPhysics(FLAT);
    var body = body(new Vec3(4.5, 1, 6.5));
    body.sprinting = true;
    for (var tick = 1; tick <= 12; tick++) {
      physics.steer(body, EAST);
      move(physics, body, tick);
    }
    assertThat(body.view(12).vel().x()).isCloseTo(MovementMotor.SPRINT_SPEED, within(0.001));
    assertThat(body.velocity.x()).isCloseTo(MovementMotor.SPRINT_SPEED * 0.546, within(0.001));
    physics.steer(body, EAST);
    physics.jump(body, 13);
    move(physics, body, 13);
    assertThat(body.onGround).isFalse();
    assertThat(body.view(13).vel().x()).isCloseTo(0.48, within(0.001));
    assertThat(body.pos.y()).isCloseTo(1.42, within(1e-9));
    var peak = body.pos.y();
    for (var tick = 14; tick <= 30; tick++) {
      physics.steer(body, EAST);
      move(physics, body, tick);
      peak = Math.max(peak, body.pos.y());
    }
    assertThat(peak).isGreaterThan(2.2);
    assertThat(body.onGround).isTrue();
    assertThat(body.pos.y()).isEqualTo(1);
    assertThat(body.fallDistance).isZero();
    assertThat(body.health).isEqualTo(20);
  }

  @Test
  void capsuleCollisionsCannotJumpThroughAThreeBlockWall() {
    var physics = new SimPhysics(FLAT);
    var body = body(new Vec3(15.5, 1, 10.5));
    body.sprinting = true;
    physics.steer(body, EAST);
    physics.jump(body, 1);
    for (var tick = 1; tick <= 25; tick++) {
      physics.steer(body, EAST);
      move(physics, body, tick);
      assertThat(body.pos.x() + 0.299).isLessThanOrEqualTo(16);
    }
    assertThat(body.onGround).isTrue();
  }

  @Test
  void unsupportedLandingStaysAirborneInsteadOfCompletingACertifiedFlightOnTheGround() {
    var physics = new SimPhysics(course(Surface.VOID));
    var body = body(new Vec3(3.7, 1, 2.5));
    body.sprinting = true;
    body.velocity = new Vec3(MovementMotor.SPRINT_SPEED * 0.546, 0, 0);
    physics.steer(body, EAST);
    physics.jump(body, 1);
    for (var tick = 1; tick <= 20; tick++) {
      physics.steer(body, EAST);
      move(physics, body, tick);
    }
    assertThat(body.onGround).isFalse();
    assertThat(body.pos.y()).isLessThan(0);
    assertThat(body.fallDistance).isGreaterThan(3);
  }

  @Test
  void actualThirtyHealthBodyRetainsHealthAboveTwentyAndPaysItsRealLandingDamage() {
    var physics = new SimPhysics(course(Surface.FLAT));
    var body = body(new Vec3(6.5, 9, 2.5));
    body.traversal = thirtyHealth();
    body.health = 30;
    body.onGround = false;
    assertThat(body.view(0).health()).isEqualTo(30);
    var observedDebt = 0.0;
    for (var tick = 1; tick <= 30 && !body.onGround; tick++) {
      move(physics, body, tick);
      observedDebt = Math.max(observedDebt, body.view(tick).traversal().fallDistance());
    }
    assertThat(observedDebt).isGreaterThan(3);
    assertThat(body.onGround).isTrue();
    assertThat(body.view(30).health()).isEqualTo(25);
    assertThat(body.view(30).traversal().maxHealth()).isEqualTo(30);
    assertThat(body.lastHurt).isPositive();
  }

  @Test
  void actualWaterLandingDiscardsAccumulatedFallDebt() {
    var physics = new SimPhysics(course(Surface.WATER));
    var body = body(new Vec3(6.5, 9, 2.5));
    body.onGround = false;
    for (var tick = 1; tick <= 45; tick++) move(physics, body, tick);
    assertThat(body.pos.y()).isLessThan(4);
    assertThat(body.health).isEqualTo(20);
    assertThat(body.fallDistance).isZero();
  }

  @Test
  void actualHalfHeightSupportIsNotRoundedToAWholeBlockOrTreatedAsCollision() {
    var nav = course(Surface.SLAB);
    var physics = new SimPhysics(nav);
    var node = nav.graph().nodeAt(new BlockPos(1, 1, 2)).orElseThrow();
    var body = body(nav.graph().feet(node));
    assertThat(body.pos.y()).isEqualTo(0.5);
    for (var tick = 1; tick <= 10; tick++) {
      physics.steer(body, EAST);
      move(physics, body, tick);
    }
    assertThat(body.onGround).isTrue();
    assertThat(body.pos.y()).isEqualTo(0.5);
    assertThat(body.pos.x()).isGreaterThan(2.5);
  }

  private static TraversalState thirtyHealth() {
    return new TraversalState(false, 3, 1, 0, -1, -1, -1, -1, 0, -1, -1, -1, -1, 30, 0);
  }

  private enum Surface {
    FLAT,
    VOID,
    WATER,
    SLAB
  }

  private static NavArtifact course(Surface surface) {
    var bounds = new GridBounds(new BlockPos(0, 0, 0), 12, 12, 5);
    var terrain =
        new BlockClassification() {
          @Override
          public GridBounds bounds() {
            return bounds;
          }

          @Override
          public BlockShape shape(int x, int y, int z) {
            if (y == 0 && (surface != Surface.VOID || x <= 3))
              return surface == Surface.SLAB ? BlockShape.SLAB_BOTTOM : BlockShape.FULL;
            if (surface == Surface.WATER && x == 6 && y >= 1 && y <= 3) return BlockShape.LIQUID;
            return BlockShape.PASSABLE;
          }

          @Override
          public boolean blocksSight(int x, int y, int z) {
            return shape(x, y, z).blocksMovement();
          }
        };
    return MapBaker.bake(
        "sim-" + surface.name().toLowerCase(java.util.Locale.ROOT),
        terrain,
        new NavSites(
            List.of(new NavSites.Site("red-spawn", Optional.of("red"), new BlockPos(1, 1, 2))),
            List.of()));
  }
}
