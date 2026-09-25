package com.shepherdjerred.thestorm.shops.domain.shop;

import java.util.Optional;

/**
 * Finds the other half of a double chest. Minecraft joins a {@code LEFT} half to the block on its
 * facing's clockwise side and a {@code RIGHT} half to the counter-clockwise side.
 */
public final class DoubleChests {

  /** Which part of a chest a block is. */
  public enum Half {
    SINGLE,
    LEFT,
    RIGHT
  }

  private DoubleChests() {}

  /** The partner block of a double-chest half, or empty for a single chest. */
  public static Optional<BlockPos> otherHalf(BlockPos chest, Facing facing, Half half) {
    return switch (half) {
      case SINGLE -> Optional.empty();
      case LEFT -> Optional.of(chest.toward(facing.clockwise()));
      case RIGHT -> Optional.of(chest.toward(facing.counterClockwise()));
    };
  }
}
