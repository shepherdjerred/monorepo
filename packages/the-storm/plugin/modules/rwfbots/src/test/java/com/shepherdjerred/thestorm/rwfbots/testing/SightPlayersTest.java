package com.shepherdjerred.thestorm.rwfbots.testing;

import static org.assertj.core.api.Assertions.assertThat;

import org.bukkit.Location;
import org.bukkit.Material;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;

final class SightPlayersTest {
  @AfterEach
  void close() {
    MockBukkit.unmock();
  }

  @Test
  void eyeRaysAreBlockedByAnInterveningFullCubeButEndAtTheTarget() {
    var server = MockBukkit.mock();
    var world = new VisibilityWorldMock(server, "sight");
    server.addWorld(world);
    var viewer = SightPlayers.add(server, "Viewer");
    var target = SightPlayers.add(server, "Target");
    viewer.teleport(new Location(world, 1.5, 1, 1.5));
    target.teleport(new Location(world, 5.5, 1, 1.5));
    assertThat(viewer.hasLineOfSight(target)).isTrue();
    world.getBlockAt(3, 2, 1).setType(Material.STONE);
    assertThat(viewer.hasLineOfSight(target)).isFalse();
    world.getBlockAt(3, 2, 1).setType(Material.AIR);
    world.getBlockAt(6, 2, 1).setType(Material.STONE);
    assertThat(viewer.hasLineOfSight(target)).isTrue();
  }
}
