package com.shepherdjerred.thestorm.spells.domain.geometry;

/** Classifies blocks for the safe-spot search; the adapter reads the world, tests fake it. */
@FunctionalInterface
public interface BlockProbe {

  Footing at(BlockPos pos);
}
