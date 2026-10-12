package com.shepherdjerred.mcbridge.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Base64;
import org.junit.jupiter.api.Test;

class PaletteGridTest {
  @Test
  void buildsPaletteInFirstSeenOrderAndEncodesLittleEndianYzx() {
    Box box = Box.of("world", new BlockPos(0, 0, 0), new BlockPos(1, 1, 0));
    PaletteGrid grid = new PaletteGrid(box);

    grid.set(0, 0, 0, "minecraft:stone");
    grid.set(1, 0, 0, "minecraft:air");
    grid.set(0, 1, 0, "minecraft:stone");
    grid.set(1, 1, 0, "minecraft:oak_stairs[facing=north]");

    assertThat(grid.palette())
        .containsExactly("minecraft:stone", "minecraft:air", "minecraft:oak_stairs[facing=north]");
    assertThat(PaletteGrid.decodeIndices(grid.encodedIndices())).containsExactly(0, 1, 0, 2);
  }

  @Test
  void encodesEachIndexAsFourLittleEndianBytes() {
    Box box = Box.of("world", new BlockPos(0, 0, 0), new BlockPos(0, 0, 0));
    PaletteGrid grid = new PaletteGrid(box);
    grid.set(0, 0, 0, "minecraft:stone");

    byte[] raw = Base64.getDecoder().decode(grid.encodedIndices());

    assertThat(raw).hasSize(4);
    assertThat(ByteBuffer.wrap(raw).order(ByteOrder.LITTLE_ENDIAN).getInt()).isZero();
  }
}
