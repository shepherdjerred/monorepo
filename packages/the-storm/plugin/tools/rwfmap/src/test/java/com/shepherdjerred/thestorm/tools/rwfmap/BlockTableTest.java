package com.shepherdjerred.thestorm.tools.rwfmap;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.rwfbots.domain.map.BlockShape;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

final class BlockTableTest {

  @CsvSource({
    "minecraft:stone, FULL, true",
    "minecraft:stone_bricks, FULL, true",
    "minecraft:red_concrete, FULL, true",
    "minecraft:oak_planks, FULL, true",
    "minecraft:gold_block, FULL, true",
    "minecraft:tnt[unstable=false], FULL, true",
    "minecraft:oak_leaves[distance=1;persistent=false;waterlogged=false], FULL, true",
    "minecraft:glass, FULL, false",
    "minecraft:red_stained_glass, FULL, false",
    "minecraft:barrier, FULL, false",
    "minecraft:oak_slab[type=bottom;waterlogged=false], SLAB_BOTTOM, true",
    "minecraft:stone_slab[type=top;waterlogged=false], SLAB_TOP, true",
    "minecraft:stone_slab[type=double;waterlogged=false], FULL, true",
    "minecraft:oak_stairs[facing=north;half=bottom;shape=straight;waterlogged=false], STAIRS, true",
    "minecraft:oak_fence[east=false;north=false;south=false;waterlogged=false;west=false], FENCE,"
        + " false",
    "minecraft:cobblestone_wall[east=none;north=none;south=none;up=true;waterlogged=false;west=none],"
        + " FENCE, false",
    "minecraft:oak_fence_gate[facing=north;in_wall=false;open=false;powered=false], FENCE, false",
    "minecraft:oak_fence_gate[facing=north;in_wall=false;open=true;powered=false], PASSABLE, false",
    "minecraft:glass_pane[east=false;north=false;south=false;waterlogged=false;west=false], PANE,"
        + " false",
    "minecraft:white_stained_glass_pane[east=false;north=false;south=false;waterlogged=false;west=false],"
        + " PANE, false",
    "minecraft:iron_bars[east=false;north=false;south=false;waterlogged=false;west=false], PANE,"
        + " false",
    "minecraft:water[level=0], LIQUID, false",
    "minecraft:cactus[age=0], SOLID_HAZARD, true",
    "minecraft:magma_block, SOLID_HAZARD, true",
    "minecraft:beacon, FULL, false",
    "minecraft:chest[facing=south;type=single;waterlogged=false], FULL, true",
    "minecraft:nether_portal[axis=x], PASSABLE, false",
    "minecraft:potted_poppy, FULL, true",
    "minecraft:sticky_piston[extended=false;facing=north], FULL, true",
    "minecraft:red_bed[facing=west;occupied=false;part=head], FULL, true",
    "minecraft:water_cauldron[level=3], FULL, true",
    "minecraft:lava[level=0], HAZARD, false",
    "minecraft:fire[age=15;east=false;north=false;south=false;up=false;west=false], HAZARD, false",
    "minecraft:ladder[facing=north;waterlogged=false], LADDER, false",
    "minecraft:vine[east=false;north=true;south=false;up=false;west=false], LADDER, false",
    "minecraft:scaffolding[bottom=false;distance=0;waterlogged=false], LADDER, false",
    "minecraft:air, PASSABLE, false",
    "minecraft:red_carpet, PASSABLE, false",
    "minecraft:stone_pressure_plate[powered=false], PASSABLE, false",
    "minecraft:poppy, PASSABLE, false",
    "minecraft:short_grass, PASSABLE, false",
    "minecraft:torch, PASSABLE, false",
    "minecraft:wall_torch[facing=north], PASSABLE, false",
    "minecraft:oak_sign[rotation=0;waterlogged=false], PASSABLE, false",
    "minecraft:oak_wall_sign[facing=north;waterlogged=false], PASSABLE, false",
    "minecraft:red_banner[rotation=0], PASSABLE, false",
    "minecraft:red_wall_banner[facing=north], PASSABLE, false",
    "minecraft:stone_button[face=wall;facing=north;powered=false], PASSABLE, false",
    "minecraft:oak_door[facing=north;half=lower;hinge=left;open=false;powered=false], DOOR, true",
    "minecraft:iron_door[facing=north;half=lower;hinge=left;open=false;powered=false], FULL, true",
    "minecraft:dragon_egg, FULL, true",
    "minecraft:oak_door[facing=north;half=lower;hinge=left;open=true;powered=false], PASSABLE,"
        + " false",
    "minecraft:oak_trapdoor[facing=north;half=bottom;open=false;powered=false;waterlogged=false],"
        + " SLAB_BOTTOM, true",
    "minecraft:oak_trapdoor[facing=north;half=top;open=false;powered=false;waterlogged=false],"
        + " SLAB_TOP, true",
    "minecraft:oak_trapdoor[facing=north;half=top;open=true;powered=false;waterlogged=false],"
        + " PASSABLE, false",
    "minecraft:snow[layers=1], PASSABLE, false",
    "minecraft:snow[layers=3], FULL, true"
  })
  @ParameterizedTest
  void classifiesCuratedStates(String state, BlockShape shape, boolean blocksSight) {
    // CSV cannot carry commas inside a value, so the properties are written with semicolons.
    var classified = BlockTable.classify(state.replace(';', ','));
    assertThat(classified.shape()).isEqualTo(shape);
    assertThat(classified.blocksSight()).isEqualTo(blocksSight);
  }

  @Test
  void everyShapeClassIsProduced() {
    var produced =
        Stream.of(
                "minecraft:stone",
                "minecraft:oak_slab[type=bottom,waterlogged=false]",
                "minecraft:oak_slab[type=top,waterlogged=false]",
                "minecraft:oak_stairs[facing=north,half=bottom,shape=straight,waterlogged=false]",
                "minecraft:oak_fence[east=false,north=false,south=false,waterlogged=false,west=false]",
                "minecraft:iron_bars[east=false,north=false,south=false,waterlogged=false,west=false]",
                "minecraft:water[level=0]",
                "minecraft:ladder[facing=north,waterlogged=false]",
                "minecraft:air",
                "minecraft:oak_door[facing=north,half=lower,hinge=left,open=false,powered=false]",
                "minecraft:cactus[age=0]",
                "minecraft:fire[age=15,east=false,north=false,south=false,up=false,west=false]")
            .map(BlockTable::classify)
            .map(BlockTable.Classified::shape)
            .toList();
    assertThat(produced).containsExactlyInAnyOrder(BlockShape.values());
  }

  @Test
  void glassIsSeenThroughButLeavesAreNot() {
    assertThat(BlockTable.classify("minecraft:glass").blocksSight()).isFalse();
    assertThat(
            BlockTable.classify(
                    "minecraft:oak_leaves[distance=7,persistent=true,waterlogged=false]")
                .blocksSight())
        .isTrue();
  }

  @Test
  void unknownStateIsAHardErrorNamingTheState() {
    assertThatThrownBy(() -> BlockTable.classify("minecraft:sculk_shrieker[can_summon=false]"))
        .isInstanceOf(UnknownBlockStateException.class)
        .hasMessageContaining("minecraft:sculk_shrieker[can_summon=false]");
  }

  @Test
  void aSlabWithoutItsTypeIsAnError() {
    assertThatThrownBy(() -> BlockTable.classify("minecraft:oak_slab"))
        .isInstanceOf(UnknownBlockStateException.class)
        .hasMessageContaining("type");
  }

  @Test
  void malformedStatesAreRejected() {
    assertThatThrownBy(() -> BlockTable.classify("stone"))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> BlockTable.classify("minecraft:stone[type"))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> BlockTable.classify("minecraft:stone[type=a,type=b]"))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
