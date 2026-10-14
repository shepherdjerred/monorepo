package com.shepherdjerred.thestorm.rwfbots.adapter.citizens;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.adapter.paper.Bodies;
import com.shepherdjerred.thestorm.rwfbots.adapter.paper.TraversalCapture;
import com.shepherdjerred.thestorm.rwfbots.adapter.paper.TraversalPlayerMock;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.MovementMotor;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.MovementSafety;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.JumpLaunch;
import java.util.Optional;
import org.bukkit.Location;
import org.bukkit.Material;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;

final class BodyMovementTest {
  private ServerMock server;
  private MovementWorldMock world;

  @BeforeEach
  void start() {
    server = MockBukkit.mock();
    world = new MovementWorldMock();
    server.addWorld(world);
    world.loadChunk(0, 0);
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  @Test
  void anExplicitClimbUsesLadderGeometryWithoutRelyingOnAnNpcCachedFlag() {
    var player = TraversalPlayerMock.add(server, "climber");
    world.getBlockAt(2, 0, 2).setType(Material.STONE);
    world.getBlockAt(2, 1, 2).setType(Material.LADDER);
    world.getBlockAt(2, 2, 2).setType(Material.LADDER);
    player.teleport(new Location(world, 2.5, 1, 2.5));
    new BodyMovement(survival(Optional.empty()))
        .move(
            player,
            new Bodies.MotionTarget(
                new Location(world, 2.5, 3, 2.5), false, Hop.CLIMB, Optional.empty()));
    assertThat(player.getVelocity().getY()).isGreaterThanOrEqualTo(0.2);
  }

  @Test
  void approachingADryBankPreservesTheUpwardExitStrokeWhenLevelSteeringIsBlocked() {
    var player = TraversalPlayerMock.add(server, "swimmer");
    for (var y = 1; y <= 3; y++) {
      world.getBlockAt(2, y, 2).setType(Material.WATER);
      world.getBlockAt(3, y, 2).setType(Material.STONE);
    }
    player.teleport(new Location(world, 2.4, 3.8, 2.5));
    var doorRequests = new java.util.ArrayList<org.bukkit.util.Vector>();
    new BodyMovement(
            survival(Optional.empty()), (body, heading) -> doorRequests.add(heading.clone()))
        .move(
            player,
            new Bodies.MotionTarget(
                new Location(world, 4.5, 4, 2.5), false, Hop.WALK, Optional.empty()));
    assertThat(player.getVelocity().getY()).isGreaterThanOrEqualTo(0.3);
    assertThat(player.getVelocity().getX()).isPositive();
    assertThat(doorRequests)
        .singleElement()
        .satisfies(heading -> assertThat(heading.getX()).isPositive());
  }

  @Test
  void aLowHealthBodyCannotStartADeepDryDropButActualImmunityCanPermitIt() {
    var player = TraversalPlayerMock.add(server, "dropper");
    world.getBlockAt(3, 0, 2).setType(Material.STONE);
    player.teleport(new Location(world, 2.5, 10, 2.5));
    player.setHealth(2);
    var target =
        new Bodies.MotionTarget(
            new Location(world, 3.5, 1, 2.5), false, Hop.DROP, Optional.empty());
    var doorRequests = new java.util.ArrayList<org.bukkit.util.Vector>();
    var ordinary =
        new BodyMovement(
            survival(Optional.empty()), (body, heading) -> doorRequests.add(heading.clone()));
    assertThat(ordinary.move(player, target)).isEqualTo(MovementSafety.Reason.BLOCKED);
    assertThat(player.getVelocity().getX()).isZero();
    var immune =
        new BodyMovement(
            survival(Optional.of(java.time.Instant.MAX)),
            (body, heading) -> doorRequests.add(heading.clone()));
    assertThat(immune.move(player, target)).isEqualTo(MovementSafety.Reason.CLEAR);
    assertThat(player.getVelocity().getX()).isPositive();
    assertThat(doorRequests)
        .hasSize(2)
        .allSatisfy(heading -> assertThat(heading.getX()).isPositive());
  }

  @Test
  void aDeepDropIntoActualWaterIsSafeButWaterBelowDryFeetDoesNotEraseAccumulatedFall() {
    var player = TraversalPlayerMock.add(server, "water-dropper");
    world.getBlockAt(3, 0, 2).setType(Material.WATER);
    player.teleport(new Location(world, 2.5, 10, 2.5));
    player.setHealth(2);
    var doorRequests = new java.util.ArrayList<org.bukkit.util.Vector>();
    var motion =
        new BodyMovement(
            survival(Optional.empty()), (body, heading) -> doorRequests.add(heading.clone()));
    assertThat(
            motion.move(
                player,
                new Bodies.MotionTarget(
                    new Location(world, 3.5, 0.5, 2.5), false, Hop.DROP, Optional.empty())))
        .isEqualTo(MovementSafety.Reason.CLEAR);
    player.teleport(new Location(world, 3.5, 1.05, 2.5));
    player.setFallDistance(8);
    motion.stop(player);
    assertThat(player.getFallDistance()).isEqualTo(8);
    assertThat(doorRequests)
        .singleElement()
        .satisfies(heading -> assertThat(heading.getX()).isPositive());
  }

  @Test
  void directedSubmergedMotionDescendsThenHoldsWithoutSurfaceBuoyancy() {
    var player = TraversalPlayerMock.add(server, "diver");
    for (var y = 1; y <= 6; y++) world.getBlockAt(2, y, 2).setType(Material.WATER);
    player.teleport(new Location(world, 2.5, 4, 2.5));
    var motion = new BodyMovement(survival(Optional.empty()));
    assertThat(
            motion.move(
                player,
                new Bodies.MotionTarget(
                    new Location(world, 2.5, 2, 2.5), false, Hop.SWIM, Optional.empty())))
        .isEqualTo(MovementSafety.Reason.CLEAR);
    assertThat(player.getVelocity().getY()).isEqualTo(-0.16);
    motion.move(
        player,
        new Bodies.MotionTarget(
            new Location(world, 2.5, 4, 2.5), false, Hop.SWIM, Optional.empty()));
    assertThat(player.getVelocity().getY()).isZero();
  }

  private static TraversalCapture survival(Optional<java.time.Instant> immunity) {
    return new TraversalCapture(
        id -> immunity, java.time.InstantSource.fixed(java.time.Instant.EPOCH));
  }

  @Test
  void lowHealthDoesNotFreezeSafeWalkingOrARedirectedRecoveryFromAnUnsafeGoal() {
    var player = TraversalPlayerMock.add(server, "recovering");
    world.getBlockAt(2, 0, 2).setType(Material.STONE);
    world.getBlockAt(2, 0, 3).setType(Material.STONE);
    player.teleport(new Location(world, 2.5, 1, 2.5));
    player.setHealth(0.5);
    var doorRequests = new java.util.ArrayList<org.bukkit.util.Vector>();
    var motion =
        new BodyMovement(
            survival(Optional.empty()), (body, heading) -> doorRequests.add(heading.clone()));
    assertThat(
            motion.move(
                player,
                new Bodies.MotionTarget(
                    new Location(world, 2.5, 1, 3.5), false, Hop.WALK, Optional.empty())))
        .isEqualTo(MovementSafety.Reason.CLEAR);
    assertThat(player.getVelocity().getZ()).isPositive();
    assertThat(
            motion.move(
                player,
                new Bodies.MotionTarget(
                    new Location(world, 4.5, -20, 2.5), false, Hop.WALK, Optional.empty())))
        .isEqualTo(MovementSafety.Reason.REDIRECTED);
    assertThat(player.getVelocity().getZ()).isPositive();
    assertThat(doorRequests).hasSize(2);
  }

  @Test
  void runUpInputKeepsMeasuredMomentumWhileItsProjectedGroundedStepStaysOnLiveFloor() {
    for (var x = 1; x <= 3; x++) world.getBlockAt(x, 0, 2).setType(Material.STONE);
    world.getBlockAt(7, 0, 2).setType(Material.STONE);
    var player = TraversalPlayerMock.add(server, "running");
    player.teleport(new Location(world, 3.43, 1, 2.5));
    player.setVelocity(new org.bukkit.util.Vector(MovementMotor.SPRINT_SPEED * 0.546, 0, 0));
    var launch = new JumpLaunch(new Vec3(3.7, 1, 2.5), new Vec3(1.7, 1, 2.5), 0.27, 13);
    var target =
        new Bodies.MotionTarget(
            new Location(world, 7.5, 1, 2.5),
            true,
            Hop.WALK,
            Optional.empty(),
            Optional.of(launch));
    var doorRequests = new java.util.ArrayList<org.bukkit.util.Vector>();
    var motion =
        new BodyMovement(
            survival(Optional.empty()), (body, heading) -> doorRequests.add(heading.clone()));
    assertThat(motion.move(player, target)).isEqualTo(MovementSafety.Reason.CLEAR);
    assertThat(player.getVelocity().getX())
        .isCloseTo(MovementMotor.SPRINT_SPEED, org.assertj.core.api.Assertions.within(1e-9));
    assertThat(player.getVelocity().getY()).isZero();
    world.getBlockAt(3, 0, 2).setType(Material.AIR);
    player.setVelocity(new org.bukkit.util.Vector());
    assertThat(motion.move(player, target)).isEqualTo(MovementSafety.Reason.BLOCKED);
    assertThat(player.getVelocity().getX()).isZero();
    assertThat(doorRequests).hasSize(2);
  }

  @Test
  void aClimberCanFinishMovingOntoItsSupportedTopLedgeAfterLeavingTheLadderCell() {
    world.getBlockAt(2, 0, 2).setType(Material.STONE);
    world.getBlockAt(2, 1, 2).setType(Material.LADDER);
    world.getBlockAt(2, 2, 2).setType(Material.LADDER);
    world.getBlockAt(2, 2, 1).setType(Material.STONE);
    world.getBlockAt(2, 2, 0).setType(Material.STONE);
    var player = TraversalPlayerMock.add(server, "ledge-exit");
    // Native collision has placed the body partly on the ledge; its centre is above the ladder.
    player.teleport(new Location(world, 2.5, 3, 2.28));
    var doorRequests = new java.util.ArrayList<org.bukkit.util.Vector>();
    var motion =
        new BodyMovement(
            survival(Optional.empty()), (body, heading) -> doorRequests.add(heading.clone()));
    var target =
        new Bodies.MotionTarget(
            new Location(world, 2.5, 3, 1.5), false, Hop.CLIMB, Optional.empty());
    assertThat(motion.move(player, target)).isEqualTo(MovementSafety.Reason.CLEAR);
    assertThat(player.getVelocity().getZ()).isNegative();
    assertThat(player.getVelocity().getY()).isZero();
    player.setVelocity(new org.bukkit.util.Vector());
    assertThat(
            motion.move(
                player,
                new Bodies.MotionTarget(
                    new Location(world, 2.5, 3, 0.5), false, Hop.CLIMB, Optional.empty())))
        .isEqualTo(MovementSafety.Reason.BLOCKED);
    world.getBlockAt(2, 2, 1).setType(Material.AIR);
    assertThat(motion.move(player, target)).isEqualTo(MovementSafety.Reason.BLOCKED);
    assertThat(player.getVelocity().getZ()).isZero();
    assertThat(doorRequests).hasSize(3);
  }
}
