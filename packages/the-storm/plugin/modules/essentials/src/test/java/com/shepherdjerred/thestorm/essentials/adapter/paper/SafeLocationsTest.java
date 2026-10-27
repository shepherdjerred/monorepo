package com.shepherdjerred.thestorm.essentials.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import org.bukkit.Location;
import org.bukkit.Material;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.world.WorldMock;

final class SafeLocationsTest {
  private ServerMock server;
  private WorldMock world;

  @BeforeEach
  void start() {
    server = MockBukkit.mock();
    world = server.addSimpleWorld("world");
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  @Test
  void hazardousOriginalColumnUsesSafeAdjacentColumn() {
    for (var y = world.getMinHeight(); y <= 90; y++) {
      world.getBlockAt(0, y, 0).setType(Material.LAVA);
    }
    world.getBlockAt(1, 63, 0).setType(Material.STONE);

    var safe = SafeLocations.nearestSafe(new Location(world, 0.5, 64, 0.5));

    assertThat(safe).isPresent();
    assertThat(safe.orElseThrow().toVector())
        .isEqualTo(new Location(world, 1.5, 64, 0.5).toVector());
  }
}
