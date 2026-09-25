package com.shepherdjerred.thestorm.npcs.app;

import java.util.List;
import java.util.Optional;

/** The NPCs that exist, for modules whose content refers to NPCs by id. Main thread. */
public interface NpcDirectory {

  /** The NPC with {@code id}, if content defines one. */
  Optional<NpcRef> find(String id);

  /** Every NPC, sorted by id. */
  List<NpcRef> all();
}
