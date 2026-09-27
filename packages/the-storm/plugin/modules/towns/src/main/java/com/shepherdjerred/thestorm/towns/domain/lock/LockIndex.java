package com.shepherdjerred.thestorm.towns.domain.lock;

import com.shepherdjerred.thestorm.towns.domain.land.BlockPos;
import java.util.Optional;
import java.util.UUID;

/** A read-only view of the locks as they stand, which lock rules check against. */
public interface LockIndex {

  /** The lock covering {@code block}, if any. */
  Optional<Lock> lockAt(BlockPos block);

  /** How many locks {@code owner} holds. */
  int countOf(UUID owner);
}
