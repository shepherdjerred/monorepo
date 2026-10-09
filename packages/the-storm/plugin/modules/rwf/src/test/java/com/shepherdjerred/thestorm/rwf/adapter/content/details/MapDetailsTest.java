package com.shepherdjerred.thestorm.rwf.adapter.content.details;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.rwf.adapter.content.MapBlocks;
import com.shepherdjerred.thestorm.rwf.adapter.content.Schematic;
import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Cuboid;
import java.util.List;
import org.bukkit.Bukkit;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;

final class MapDetailsTest {
  @BeforeAll
  static void start() {
    MockBukkit.mock();
  }

  @AfterAll
  static void stop() {
    MockBukkit.unmock();
  }

  private MapBlocks blocks() {
    var schematic =
        new Schematic(
            new Schematic.Dimensions(1, 1, 1),
            List.of("minecraft:chest[facing=north,type=single,waterlogged=false]"),
            new int[] {0});
    return MapBlocks.resolve(
        schematic,
        new Cuboid(new BlockPos(100, 64, -100), new BlockPos(100, 64, -100)),
        Bukkit::createBlockData);
  }

  @Test
  void payloadsMustMatchTerrainIdentityMaterialAndBounds() {
    var blocks = blocks();
    var at = new BlockPos(0, 0, 0);
    var chest = new MapDetails.Container(at, "minecraft:chest", "AA==");
    new MapDetails(1, blocks.schematic().sha256(), List.of(chest), List.of())
        .validate(blocks.schematic());
    assertThatThrownBy(() -> MapDetails.empty("0".repeat(64)).validate(blocks.schematic()))
        .hasMessageContaining("hash mismatch");
    assertThatThrownBy(
            () ->
                new MapDetails(
                        1,
                        blocks.schematic().sha256(),
                        List.of(new MapDetails.Container(at, "minecraft:furnace", "AA==")),
                        List.of())
                    .validate(blocks.schematic()))
        .hasMessageContaining("material differs");
    assertThatThrownBy(
            () ->
                new MapDetails(
                        1,
                        blocks.schematic().sha256(),
                        List.of(
                            new MapDetails.Container(
                                new BlockPos(1, 0, 0), "minecraft:chest", "AA==")),
                        List.of())
                    .validate(blocks.schematic()))
        .hasMessageContaining("outside the schematic");
  }

  @Test
  void duplicatePayloadsMalformedInventoriesAndInvalidSignsAreRefused() {
    var chest = new MapDetails.Container(new BlockPos(0, 0, 0), "minecraft:chest", "AA==");
    assertThatThrownBy(() -> new MapDetails(1, "a".repeat(64), List.of(chest, chest), List.of()))
        .hasMessageContaining("duplicate");
    assertThatThrownBy(() -> new MapDetails.Container(chest.at(), chest.material(), "not base64!"))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new MapDetails.Face(List.of("one"), "BLACK", false))
        .hasMessageContaining("four");
    assertThatThrownBy(() -> new MapDetails.Face(List.of("", "", "", ""), "UNKNOWN", false))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
