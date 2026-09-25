package com.shepherdjerred.thestorm.core.protection;

import java.util.UUID;
import org.bukkit.Location;

/**
 * Decides whether a player may act at a location. Main thread only: implementations read their
 * claim state from memory.
 */
public interface Protection {

  Decision check(UUID player, ProtectedAction action, Location location);
}
