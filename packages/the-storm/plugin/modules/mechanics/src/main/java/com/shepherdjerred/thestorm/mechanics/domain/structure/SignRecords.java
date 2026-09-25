package com.shepherdjerred.thestorm.mechanics.domain.structure;

import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import java.util.Optional;

/** The signs of one world, as the structure binder sees them. */
@FunctionalInterface
public interface SignRecords {

  /** The sign at {@code pos}, empty when there is none. */
  Optional<SignRecord> at(Pos pos);
}
