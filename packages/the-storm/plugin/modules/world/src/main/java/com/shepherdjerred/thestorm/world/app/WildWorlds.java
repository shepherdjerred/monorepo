package com.shepherdjerred.thestorm.world.app;

import java.util.List;
import java.util.Optional;

/** The worlds random teleport may use. */
public interface WildWorlds {

  /** Every created world, in config order. */
  List<WildWorld> worlds();

  /** The world named {@code name}, if this module created it. */
  Optional<WildWorld> named(String name);

  /** The first world that allows random teleport. */
  WildWorld defaultWorld();
}
