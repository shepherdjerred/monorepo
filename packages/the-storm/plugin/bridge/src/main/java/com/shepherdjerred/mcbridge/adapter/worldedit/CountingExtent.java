package com.shepherdjerred.mcbridge.adapter.worldedit;

import com.sk89q.worldedit.WorldEditException;
import com.sk89q.worldedit.extent.AbstractDelegateExtent;
import com.sk89q.worldedit.extent.Extent;
import com.sk89q.worldedit.math.BlockVector3;
import com.sk89q.worldedit.world.block.BlockStateHolder;
import java.util.function.IntConsumer;

/**
 * Counts blocks whose state actually changes. Installed at {@code Stage.BEFORE_CHANGE}, just above
 * the world, so it sees exactly what reaches the world: WorldEdit's own "N blocks affected"
 * messages count attempted sets (e.g. {@code //hcyl 4 14} reports 392 while 336 change).
 */
final class CountingExtent extends AbstractDelegateExtent {
  private final IntConsumer onChange;

  CountingExtent(Extent extent, IntConsumer onChange) {
    super(extent);
    this.onChange = onChange;
  }

  @Override
  public <T extends BlockStateHolder<T>> boolean setBlock(BlockVector3 location, T block)
      throws WorldEditException {
    boolean differs = !getExtent().getBlock(location).equals(block.toImmutableState());
    boolean set = super.setBlock(location, block);
    if (set && differs) {
      onChange.accept(1);
    }
    return set;
  }
}
