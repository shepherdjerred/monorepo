package com.shepherdjerred.thestorm.tools.rwfmap;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.adapter.content.Schematic;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Cuboid;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import tools.jackson.databind.json.JsonMapper;

final class CloseStartsTest {
  @Test
  void shippedTerrainSuppliesDeterministicReachableGroundedStartsWithoutMutation() {
    var map = MapFolder.load(ShippedMapsTest.MAPS.resolve("training-yard"));
    var before = map.schematic().sha256();
    var baked = Baker.bake(map);
    var pair = CloseStarts.select(map, baked);
    var terrain = new StartTerrain(map.classify());
    assertThat(pair).isEqualTo(CloseStarts.select(map, baked));
    assertThat(pair.first().y()).isEqualTo(pair.second().y());
    assertThat(pair.first().distance(pair.second())).isBetween(8.0, 16.0);
    assertThat(terrain.patch(BlockPos.of(pair.first()), 1)).isTrue();
    assertThat(terrain.patch(BlockPos.of(pair.second()), 1)).isTrue();
    assertThat(terrain.corridor(pair.first(), pair.second())).isTrue();
    var graph = baked.artifact().graph();
    for (var spawn : baked.artifact().sites().spawns()) {
      var source = graph.nearestNode(spawn.cell().feet()).orElseThrow();
      for (var target : List.of(pair.first(), pair.second())) {
        assertThat(graph.path(source, graph.nearestNode(target).orElseThrow())).isPresent();
      }
    }
    var report = JsonMapper.builder().build().readTree(CloseStartReport.of(map, pair).json());
    assertThat(report.path("kind").asString()).isEqualTo("rwf-close-starts");
    assertThat(report.path("blocksSha256").asString()).isEqualTo(before);
    assertThat(report.path("starts").size()).isEqualTo(2);
    assertThat(map.schematic().sha256()).isEqualTo(before);
    assertThat(MapFolder.load(map.folder()).definition()).isEqualTo(map.definition());
  }

  @ValueSource(
      strings = {
        "minecraft:stone",
        "minecraft:oak_planks",
        "minecraft:blue_wool",
        "minecraft:sandstone",
        "minecraft:stone_slab[type=top,waterlogged=false]",
        "minecraft:oak_slab[type=double,waterlogged=false]"
      })
  @ParameterizedTest
  void acceptsOnlyExactFullHeightGround(String block) {
    assertThat(StartTerrain.support(block)).isTrue();
  }

  @ValueSource(
      strings = {
        "minecraft:water[level=0]",
        "minecraft:ladder[facing=north,waterlogged=false]",
        "minecraft:stone_slab[type=bottom,waterlogged=false]",
        "minecraft:oak_stairs[facing=north,half=bottom,shape=straight,waterlogged=false]",
        "minecraft:chest[facing=north,type=single,waterlogged=false]",
        "minecraft:honey_block",
        "minecraft:slime_block",
        "minecraft:farmland[moisture=0]",
        "minecraft:snow[layers=2]",
        "minecraft:oak_door[facing=north,half=lower,hinge=left,open=false,powered=false]"
      })
  @ParameterizedTest
  void rejectsPartialFluidAndUnstableSupport(String block) {
    assertThat(StartTerrain.support(block)).isFalse();
  }

  @Test
  void corridorRejectsWallsGapsAndLowCeilings() {
    var indices = new int[20 * 4 * 5];
    Arrays.fill(indices, 0, 20 * 5, 1);
    var from = new Vec3(2.5, 1, 2.5);
    var to = new Vec3(14.5, 1, 2.5);
    assertThat(terrain(indices).corridor(from, to)).isTrue();
    indices[(1 * 5 + 2) * 20 + 10] = 1;
    assertThat(terrain(indices).corridor(from, to)).isFalse();
    indices[(1 * 5 + 2) * 20 + 10] = 0;
    indices[(0 * 5 + 2) * 20 + 10] = 0;
    assertThat(terrain(indices).corridor(from, to)).isFalse();
    indices[(0 * 5 + 2) * 20 + 10] = 1;
    indices[(2 * 5 + 2) * 20 + 10] = 1;
    assertThat(terrain(indices).corridor(from, to)).isFalse();
  }

  private static StartTerrain terrain(int[] indices) {
    var schematic =
        new Schematic(
            new Schematic.Dimensions(20, 4, 5),
            List.of("minecraft:air", "minecraft:stone"),
            indices);
    var region =
        new Cuboid(
            new com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos(0, 0, 0),
            new com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos(19, 3, 4));
    return new StartTerrain(SchematicClassification.of("geometry-unit", schematic, region));
  }
}
