package com.shepherdjerred.thestorm.skylands.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.skylands.domain.SkyPosition;
import java.util.ArrayList;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.WorldCreator;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.world.WorldMock;

final class NativeTemplateGeometryTest {
  @Test
  void sparseNativeRoomsHaveUsableStandingSpaceWithoutExplicitAirCells() {
    MockBukkit.mock();
    try {
      var world = new WorldMock(WorldCreator.ofKey(NamespacedKey.minecraft("native_geometry")));
      var cells = new ArrayList<NativeSkyTemplates.Cell>();
      for (var x = 2; x <= 4; x++) {
        for (var z = 2; z <= 4; z++) {
          var block = world.getBlockAt(x, 0, z);
          block.setType(Material.ACACIA_PLANKS);
          cells.add(
              new NativeSkyTemplates.Cell(
                  new SkyPosition(x, 0, z), block.getState(), block.getBlockData()));
        }
      }
      var bed = world.getBlockAt(4, 1, 2);
      bed.setBlockData(Bukkit.createBlockData("minecraft:orange_bed[part=head,facing=west]"));
      cells.add(
          new NativeSkyTemplates.Cell(
              new SkyPosition(4, 1, 2), bed.getState(), bed.getBlockData()));
      var shape =
          NativeTemplateGeometry.describe(
              "village/savanna/houses/savanna_medium_house_2", new SkyPosition(10, 8, 11), cells);
      assertThat(shape.residents())
          .singleElement()
          .satisfies(
              p -> {
                assertThat(p.y()).isEqualTo(1);
                assertThat(world.getBlockAt(p.x(), p.y() - 1, p.z()).getType())
                    .isEqualTo(Material.ACACIA_PLANKS);
                assertThat(p).isNotEqualTo(new SkyPosition(4, 1, 2));
              });
    } finally {
      MockBukkit.unmock();
    }
  }
}
