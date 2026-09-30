package com.shepherdjerred.thestorm.shards.domain;

/**
 * A block players right-click to upgrade gear. The first configured altar is the emerald block in
 * the spawn windmill.
 *
 * @param world the world key, such as {@code minecraft:overworld}
 * @param x block x
 * @param y block y
 * @param z block z
 * @param material the Paper block material that must be there, such as {@code EMERALD_BLOCK}; the
 *     module refuses to start when the configured block is anything else
 */
public record AltarLocation(String world, int x, int y, int z, String material) {

  public AltarLocation {
    Checks.key("altars[].world", world);
    Checks.constant("altars[].material", material);
  }

  /** The altar's position. */
  public BlockPos position() {
    return new BlockPos(world, x, y, z);
  }

  /** Whether {@code block} at {@code position} is this altar: the right place and material. */
  public boolean is(BlockPos block, String blockMaterial) {
    return position().equals(block) && material.equals(blockMaterial);
  }
}
