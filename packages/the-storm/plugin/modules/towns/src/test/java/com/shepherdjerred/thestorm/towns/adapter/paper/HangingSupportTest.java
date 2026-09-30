package com.shepherdjerred.thestorm.towns.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import org.bukkit.block.BlockFace;
import org.bukkit.util.BoundingBox;
import org.junit.jupiter.api.Test;

final class HangingSupportTest {

  @Test
  void everyBlockBehindALargePaintingSupportsIt() {
    var painting = new BoundingBox(0, 0, 0.875, 4, 4, 0.9375);
    var farCorner = new BoundingBox(3, 3, 1, 4, 4, 2);
    var outside = new BoundingBox(4, 3, 1, 5, 4, 2);

    assertThat(BlockListener.backingBlock(painting, BlockFace.SOUTH, farCorner)).isTrue();
    assertThat(BlockListener.backingBlock(painting, BlockFace.SOUTH, outside)).isFalse();
  }
}
