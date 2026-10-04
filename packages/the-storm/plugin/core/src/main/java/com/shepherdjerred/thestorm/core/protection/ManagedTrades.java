package com.shepherdjerred.thestorm.core.protection;

import org.bukkit.Location;

/** Shared main-thread gate for commerce in a managed area, including trades in flight. */
public interface ManagedTrades {
  boolean active(Location location);
}
