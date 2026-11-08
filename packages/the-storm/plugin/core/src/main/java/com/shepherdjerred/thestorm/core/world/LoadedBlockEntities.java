package com.shepherdjerred.thestorm.core.world;

import org.bukkit.Chunk;
import org.bukkit.block.BlockState;

/** Main-thread enumeration of the block entities in an already loaded chunk. */
@FunctionalInterface
public interface LoadedBlockEntities {
  BlockState[] inChunk(Chunk chunk);
}
