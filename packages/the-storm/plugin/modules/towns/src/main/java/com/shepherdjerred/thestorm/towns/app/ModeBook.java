package com.shepherdjerred.thestorm.towns.app;

import com.shepherdjerred.thestorm.towns.domain.lock.LockModes;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/** Sticky lock modes, held in memory and saved behind it. Main thread only. */
public final class ModeBook {

  private final Map<UUID, LockModes> modes = new HashMap<>();

  public LockModes get(UUID player) {
    return modes.getOrDefault(player, LockModes.NONE);
  }

  public void put(UUID player, LockModes next) {
    modes.put(player, next);
  }

  public void load(Map<UUID, LockModes> loaded) {
    modes.clear();
    modes.putAll(loaded);
  }
}
