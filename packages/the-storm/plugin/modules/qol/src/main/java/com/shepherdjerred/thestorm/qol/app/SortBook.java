package com.shepherdjerred.thestorm.qol.app;

import com.shepherdjerred.thestorm.qol.domain.sort.SortSwitches;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/** Sort switches in memory. A player with no row keeps the defaults. */
public final class SortBook {

  private final SortSwitches defaults;
  private final Map<UUID, SortSwitches> byPlayer = new HashMap<>();
  private boolean loaded;

  public SortBook(SortSwitches defaults) {
    this.defaults = defaults;
  }

  public void load(Map<UUID, SortSwitches> stored) {
    byPlayer.clear();
    byPlayer.putAll(stored);
    loaded = true;
  }

  public boolean isLoaded() {
    return loaded;
  }

  public SortSwitches get(UUID player) {
    return byPlayer.getOrDefault(player, defaults);
  }

  public void put(UUID player, SortSwitches switches) {
    byPlayer.put(player, switches);
  }
}
