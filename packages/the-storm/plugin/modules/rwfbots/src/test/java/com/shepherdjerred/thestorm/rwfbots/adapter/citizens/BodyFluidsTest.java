package com.shepherdjerred.thestorm.rwfbots.adapter.citizens;

import static org.assertj.core.api.Assertions.assertThat;

import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.block.data.Waterlogged;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.block.data.LadderDataMock;

final class BodyFluidsTest {
  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  @Test
  void readsActualWaterloggedLadderDataAndAlwaysSubmergedPlants() {
    var world = MockBukkit.mock().addSimpleWorld("fluids");
    var block = world.getBlockAt(0, 100, 0);
    // The generic MockBukkit material factory currently omits LadderDataMock.
    var ladder = new LadderDataMock(Material.LADDER);
    block.setBlockData(ladder);
    assertThat(BodyFluids.containsWater(block)).isFalse();
    ladder.setWaterlogged(true);
    block.setBlockData(ladder);
    assertThat(BodyFluids.containsWater(block)).isTrue();
    for (var material :
        new Material[] {
          Material.SEAGRASS, Material.TALL_SEAGRASS, Material.KELP, Material.KELP_PLANT
        }) {
      block.setType(material);
      assertThat(BodyFluids.containsWater(block)).as(material.name()).isTrue();
    }
    block.setType(Material.AIR);
    assertThat(BodyFluids.containsWater(block)).isFalse();
    block.setType(Material.LAVA);
    assertThat(BodyFluids.containsWater(block)).isFalse();
  }

  @Test
  void standingAboveAWaterloggedSolidDoesNotGrantSwimmingInDryAir() {
    var server = MockBukkit.mock();
    var world = server.addSimpleWorld("fluids");
    var block = world.getBlockAt(0, 100, 0);
    block.setType(Material.OAK_SLAB);
    var slab = (Waterlogged) block.getBlockData();
    slab.setWaterlogged(true);
    block.setBlockData(slab);
    var player = server.addPlayer();
    assertThat(player.teleport(new Location(world, 0.5, 101, 0.5))).isTrue();
    assertThat(BodyFluids.inWater(player)).isFalse();
  }

  @Test
  void nearbyWaterBelowDryFeetCannotCancelAnAccumulatedFall() {
    var server = MockBukkit.mock();
    var world = server.addSimpleWorld("fluids");
    world.getBlockAt(0, 100, 0).setType(Material.WATER);
    var player = server.addPlayer();
    assertThat(player.teleport(new Location(world, 0.5, 101.05, 0.5))).isTrue();
    assertThat(BodyFluids.inWater(player)).isTrue();
    assertThat(BodyFluids.cancelsFall(player)).isFalse();
    assertThat(player.teleport(new Location(world, 0.5, 100.5, 0.5))).isTrue();
    assertThat(BodyFluids.cancelsFall(player)).isTrue();
  }
}
