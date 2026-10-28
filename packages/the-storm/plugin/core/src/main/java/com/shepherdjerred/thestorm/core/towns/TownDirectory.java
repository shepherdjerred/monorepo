package com.shepherdjerred.thestorm.core.towns;

import java.util.Optional;

/** Towns by name. The towns module publishes this; it is absent when that module is not enabled. */
public interface TownDirectory {

  /** The town called {@code name}, ignoring case. Empty when no town has that name. */
  Optional<NamedTown> named(String name);
}
