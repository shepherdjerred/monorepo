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
import org.mockbukkit.mockbukkit.world.WorldMock;

final class MovementTerrainTest {
  private WorldMock world;
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
        new MovementTerrain(world, Optional.of(new GridBounds(new BlockPos(0, 0, 0), 5, 8, 5)));
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
}
