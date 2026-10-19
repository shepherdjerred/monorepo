package com.shepherdjerred.thestorm.rwfbots.adapter.citizens;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.GridBounds;
import java.util.Optional;
import org.bukkit.Material;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;

final class MovementTerrainTest {
  private MovementWorldMock world;
  private MovementTerrain terrain;

  @BeforeEach
  void start() {
    var server = MockBukkit.mock();
    world = new MovementWorldMock();
    server.addWorld(world);
    world.loadChunk(0, 0);
    for (var x = 0; x < 5; x++) {
      for (var z = 0; z < 5; z++) world.getBlockAt(x, 0, z).setType(Material.STONE);
    }
    terrain =
        new MovementTerrain(
            world,
            Optional.of(new GridBounds(new BlockPos(0, 0, 0), 5, 8, 5)),
            world::collides,
            false);
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  @Test
  void ordinaryFloorSupportsFeetButTheEdgeAndADeletedFloorDoNot() {
    assertThat(terrain.supported(new Vec3(2.5, 1, 2.5), 1.1)).isTrue();
    assertThat(terrain.supported(new Vec3(0.1, 1, 2.5), 1.1)).isFalse();
    world.getBlockAt(2, 0, 2).setType(Material.AIR);
    assertThat(terrain.supported(new Vec3(2.5, 1, 2.5), 1.1)).isFalse();
  }

  @Test
  void movementReReadsNewFireAndDamagingFloorBlocks() {
    var feet = new Vec3(2.5, 1, 2.5);
    assertThat(terrain.hazardous(feet)).isFalse();
    world.getBlockAt(2, 1, 2).setType(Material.FIRE);
    assertThat(terrain.hazardous(feet)).isTrue();
    world.getBlockAt(2, 1, 2).setType(Material.AIR);
    world.getBlockAt(2, 0, 2).setType(Material.MAGMA_BLOCK);
    assertThat(terrain.hazardous(feet)).isTrue();
    assertThat(terrain.supported(feet, 1.1)).isFalse();
  }

  @Test
  void lavaIsNeverTreatedAsSwimmingWaterAndMapBoundsIncludeTheWholeBody() {
    var feet = new Vec3(2.5, 1, 2.5);
    world.getBlockAt(2, 1, 2).setType(Material.LAVA);
    assertThat(terrain.inWater(feet)).isFalse();
    world.getBlockAt(2, 1, 2).setType(Material.WATER);
    world.getBlockAt(2, 2, 2).setType(Material.WATER);
    assertThat(terrain.inWater(feet)).isTrue();
    assertThat(terrain.waterSurface(feet)).isEqualTo(3);
    assertThat(terrain.inside(feet)).isTrue();
    assertThat(terrain.inside(new Vec3(4.9, 1, 2.5))).isFalse();
  }

  @Test
  void bankExitRequiresANearbyDrySafeLandingRatherThanTreatingOpenWaterAsABank() {
    for (var x = 0; x < 3; x++) {
      for (var y = 1; y <= 3; y++) world.getBlockAt(x, y, 2).setType(Material.WATER);
    }
    var feet = new Vec3(2.4, 3.6, 2.5);
    var goal = new Vec3(4.5, 4, 2.5);
    assertThat(terrain.bankExit(feet, goal)).isEmpty();
    for (var y = 1; y <= 3; y++) world.getBlockAt(3, y, 2).setType(Material.STONE);
    assertThat(terrain.bankExit(feet, goal))
        .hasValueSatisfying(
            bank -> {
              assertThat(bank.y()).isEqualTo(4);
              assertThat(bank.x()).isGreaterThanOrEqualTo(3.25);
              assertThat(terrain.clear(bank)).isTrue();
            });
    world.getBlockAt(3, 3, 2).setType(Material.MAGMA_BLOCK);
    assertThat(terrain.bankExit(feet, goal)).isEmpty();
  }

  @Test
  void nativeClimbabilityComesFromTheActualLadderCells() {
    var feet = new Vec3(2.5, 1, 2.5);
    assertThat(terrain.climbable(feet)).isFalse();
    world.getBlockAt(2, 1, 2).setType(Material.LADDER);
    assertThat(terrain.climbable(feet)).isTrue();
  }

  @Test
  void aBodyTouchingACeilingIsNotCollidingWithIt() {
    // the-harshest-harvest: a pond under a cobblestone roof. Buoyancy pressed a swimmer's head to
    // the roof at feet 9.2; counting that touch as a collision froze it in place for minutes.
    world.getBlockAt(2, 1, 2).setType(Material.WATER);
    world.getBlockAt(2, 3, 2).setType(Material.STONE);
    assertThat(terrain.clear(new Vec3(2.5, 1.2, 2.5))).isTrue();
    assertThat(terrain.clear(new Vec3(2.5, 1.25, 2.5))).as("a head inside the roof").isFalse();
  }

  @Test
  void aBodyPerchedOnABlockEdgeIsGroundedAndCanStepBackOntoIt() {
    // hemispheres: bodies resting part of their footprint on a stair or ledge edge, with air under
    // their centre, read as floorless and refused every step, even back onto the block.
    world.getBlockAt(1, 1, 2).setType(Material.STONE);
    var perched = new Vec3(2.2, 2, 2.5);
    var edge =
        new MovementTerrain(
            world,
            Optional.of(new GridBounds(new BlockPos(0, 0, 0), 5, 8, 5)),
            world::collides,
            false);
    assertThat(edge.grounded(perched)).isTrue();
    assertThat(
            com.shepherdjerred.thestorm.rwfbots.domain.reflex.MovementSafety.choose(
                    edge,
                    new com.shepherdjerred.thestorm.rwfbots.domain.reflex.MovementSafety.Request(
                        perched,
                        new Vec3(1.5, 2, 2.5),
                        com.shepherdjerred.thestorm.rwfbots.domain.world.Hop.WALK))
                .reason())
        .isNotEqualTo(
            com.shepherdjerred.thestorm.rwfbots.domain.reflex.MovementSafety.Reason.BLOCKED);
    assertThat(edge.grounded(new Vec3(2.5, 2, 2.5))).as("clear of the edge").isFalse();
  }

  @Test
  void aBodyBesideAStairsLowStepStandsOnTheStepNotOnTheStairsWholeBox() {
    // cloned-balance: slab and stair floors read as floorless one step ahead, because support was
    // taken from a stair's union box, a full block high over its low step too.
    for (var x = 0; x < 5; x++) {
      for (var z = 0; z < 5; z++) world.getBlockAt(x, 1, z).setType(Material.STONE_SLAB);
    }
    world.getBlockAt(3, 1, 2).setType(Material.STONE_STAIRS);
    var feet = new Vec3(1.5, 1.5, 2.85);
    assertThat(terrain.supported(new Vec3(3.5, 1.5, 2.85), 1.1)).isTrue();
    assertThat(
            com.shepherdjerred.thestorm.rwfbots.domain.reflex.MovementSafety.choose(
                    terrain,
                    new com.shepherdjerred.thestorm.rwfbots.domain.reflex.MovementSafety.Request(
                        feet,
                        new Vec3(4.4, 1.5, 2.85),
                        com.shepherdjerred.thestorm.rwfbots.domain.world.Hop.WALK))
                .reason())
        .isEqualTo(com.shepherdjerred.thestorm.rwfbots.domain.reflex.MovementSafety.Reason.CLEAR);
  }

  @Test
  void blocksTouchingOnlyAtACornerHoldABodyCrossingBetweenThem() {
    // hemispheres: a diagonal wall of corner-touching blocks walked along its top. Crossing the
    // shared corner, two footprint corners rest on the blocks and two over air.
    world.getBlockAt(1, 1, 2).setType(Material.STONE);
    world.getBlockAt(2, 1, 1).setType(Material.STONE);
    assertThat(terrain.supported(new Vec3(2.0, 2, 2.0), 0.1)).isTrue();
    assertThat(terrain.supported(new Vec3(2.0, 2, 1.0), 0.1))
        .as("only one corner on a block")
        .isFalse();
  }

  @Test
  void aBodyAtTheEdgeOfANarrowWalkwayCanStepBackToItsMiddle() {
    // hemispheres: a one-block slab walkway on a wall; a body near its north edge has two
    // footprint corners over air, and refused every step, even back toward the walkway's middle.
    for (var x = 0; x < 5; x++) {
      for (var z = 0; z < 5; z++) world.getBlockAt(x, 0, z).setType(Material.AIR);
      world.getBlockAt(x, 0, 2).setType(Material.STONE);
    }
    var edge = new Vec3(3.5, 1, 2.05);
    assertThat(terrain.supported(edge, 0.1)).as("hanging over the edge").isFalse();
    assertThat(
            com.shepherdjerred.thestorm.rwfbots.domain.reflex.MovementSafety.choose(
                    terrain,
                    new com.shepherdjerred.thestorm.rwfbots.domain.reflex.MovementSafety.Request(
                        edge,
                        new Vec3(1.5, 1, 2.5),
                        com.shepherdjerred.thestorm.rwfbots.domain.world.Hop.WALK))
                .reason())
        .isNotEqualTo(
            com.shepherdjerred.thestorm.rwfbots.domain.reflex.MovementSafety.Reason.BLOCKED);
  }

  @Test
  void aBodyOffCentreUnderAnOverhangTakesOffFromItsCellsCentre() {
    // hemispheres: a body 0.3 off its node's centre raised its head into a stair overhanging the
    // next column for every jump onto the step ahead, and stood refused for over five minutes.
    world.getBlockAt(3, 1, 2).setType(Material.STONE);
    world.getBlockAt(1, 3, 2).setType(Material.STONE);
    var from = new Vec3(2.21, 1, 2.5);
    var request =
        new com.shepherdjerred.thestorm.rwfbots.domain.reflex.MovementSafety.Request(
            from, new Vec3(3.5, 2, 2.5), com.shepherdjerred.thestorm.rwfbots.domain.world.Hop.JUMP);
    var result =
        com.shepherdjerred.thestorm.rwfbots.domain.reflex.MovementSafety.choose(terrain, request);
    assertThat(result.reason())
        .isEqualTo(
            com.shepherdjerred.thestorm.rwfbots.domain.reflex.MovementSafety.Reason.REDIRECTED);
    assertThat(result.destination()).contains(new Vec3(2.5, 1, 2.5));
  }

  @Test
  void aWalkRoundTheCornerOfANarrowPathIsClearWhenItsLookAheadPointHangsOverTheCorner() {
    // hemispheres: on one-block walkways the steering probe's look-ahead point, short of the
    // target, fell where only part of the footprint was on a block; it was asked for full support
    // and every walk along the path was refused although its end stood fully on the path.
    for (var x = 0; x < 5; x++) {
      for (var z = 0; z < 5; z++) world.getBlockAt(x, 0, z).setType(Material.AIR);
      world.getBlockAt(x, 0, 2).setType(Material.STONE);
    }
    world.getBlockAt(1, 0, 3).setType(Material.STONE);
    var request =
        new com.shepherdjerred.thestorm.rwfbots.domain.reflex.MovementSafety.Request(
            new Vec3(3.5, 1, 2.5),
            new Vec3(1.5, 1, 3.5),
            com.shepherdjerred.thestorm.rwfbots.domain.world.Hop.WALK);
    assertThat(
            com.shepherdjerred.thestorm.rwfbots.domain.reflex.MovementSafety.choose(
                    terrain, request)
                .reason())
        .isEqualTo(com.shepherdjerred.thestorm.rwfbots.domain.reflex.MovementSafety.Reason.CLEAR);
  }
}
