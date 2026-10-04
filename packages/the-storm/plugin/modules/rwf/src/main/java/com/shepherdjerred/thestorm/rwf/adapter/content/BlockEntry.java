package com.shepherdjerred.thestorm.rwf.adapter.content;

import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;

/**
 * A block position as the YAML writes it: {@code {x, y, z}}.
 *
 * @param x east
 * @param y up
 * @param z south
 */
public record BlockEntry(int x, int y, int z) {

  public BlockPos toBlock() {
    return new BlockPos(x, y, z);
  }
}
