package com.shepherdjerred.thestorm.rwf.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.rwf.domain.kit.SafeTeleport;
import com.shepherdjerred.thestorm.rwf.domain.kit.SafeTeleport.Footing;
import java.util.Arrays;
import java.util.Map;
import org.bukkit.Material;
import org.bukkit.block.BlockFace;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;

/** The original's block tables and trap shape, in today's blocks (MockBukkit, for the tags). */
final class FootingsTest {

  @BeforeAll
  static void mock() {
    MockBukkit.mock();
  }

  @AfterAll
  static void unmock() {
    MockBukkit.unmock();
  }

  @Test
  void theTrapShapeIsBukkitsBlockFacesInOrder() {
    assertThat(SafeTeleport.FACES)
        .containsExactlyElementsOf(
            Arrays.stream(BlockFace.values())
                .map(face -> new BlockPos(face.getModX(), face.getModY(), face.getModZ()))
                .toList());
  }

  @Test
  void blocksReadAsTheOriginalsTablesListedThem() {
    var expected =
        Map.ofEntries(
            Map.entry(Material.STONE_PRESSURE_PLATE, Footing.TRAP),
            Map.entry(Material.OAK_PRESSURE_PLATE, Footing.TRAP),
            Map.entry(Material.BIRCH_PRESSURE_PLATE, Footing.TRAP),
            Map.entry(Material.HEAVY_WEIGHTED_PRESSURE_PLATE, Footing.TRAP),
            Map.entry(Material.TRIPWIRE, Footing.TRAP),
            Map.entry(Material.LIGHT_WEIGHTED_PRESSURE_PLATE, Footing.CLEAR),
            Map.entry(Material.TRIPWIRE_HOOK, Footing.CLEAR),
            Map.entry(Material.AIR, Footing.CLEAR),
            Map.entry(Material.SHORT_GRASS, Footing.CLEAR),
            Map.entry(Material.TORCH, Footing.CLEAR),
            Map.entry(Material.FIRE, Footing.CLEAR),
            Map.entry(Material.OAK_SIGN, Footing.CLEAR),
            Map.entry(Material.WATER, Footing.PARTIAL),
            Map.entry(Material.LAVA, Footing.PARTIAL),
            Map.entry(Material.COBWEB, Footing.PARTIAL),
            Map.entry(Material.VINE, Footing.PARTIAL),
            Map.entry(Material.LADDER, Footing.PARTIAL),
            Map.entry(Material.OAK_DOOR, Footing.PARTIAL),
            Map.entry(Material.OAK_TRAPDOOR, Footing.PARTIAL),
            Map.entry(Material.OAK_FENCE_GATE, Footing.PARTIAL),
            Map.entry(Material.GLASS_PANE, Footing.PARTIAL),
            Map.entry(Material.IRON_BARS, Footing.PARTIAL),
            Map.entry(Material.CAKE, Footing.PARTIAL),
            Map.entry(Material.SKELETON_SKULL, Footing.PARTIAL),
            Map.entry(Material.STONE, Footing.STANDABLE),
            Map.entry(Material.GLASS, Footing.STANDABLE),
            Map.entry(Material.OAK_LEAVES, Footing.STANDABLE),
            Map.entry(Material.OAK_SLAB, Footing.STANDABLE),
            Map.entry(Material.OAK_STAIRS, Footing.STANDABLE),
            Map.entry(Material.OAK_FENCE, Footing.STANDABLE),
            Map.entry(Material.COBBLESTONE_WALL, Footing.STANDABLE),
            Map.entry(Material.WHITE_CARPET, Footing.STANDABLE),
            Map.entry(Material.SNOW, Footing.STANDABLE),
            Map.entry(Material.CHEST, Footing.STANDABLE),
            Map.entry(Material.SOUL_SAND, Footing.STANDABLE),
            Map.entry(Material.RED_BED, Footing.STANDABLE));
    expected.forEach(
        (material, footing) ->
            assertThat(Footings.of(material)).as(material.name()).isEqualTo(footing));
  }
}
