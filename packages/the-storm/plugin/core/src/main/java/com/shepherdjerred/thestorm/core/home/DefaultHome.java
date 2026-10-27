package com.shepherdjerred.thestorm.core.home;

import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.bukkit.Location;

/**
 * Sets a player's default home when they do not already have one. Towns asks for this when a camp
 * is created automatically, and essentials owns the homes. Callers look the port up when the event
 * happens, because essentials starts after towns.
 */
public interface DefaultHome {

  /**
   * Sets {@code where} as {@code player}'s default home when they have none and home rules allow
   * it. True when a home was created. False when they already have one, or the spot cannot be a
   * home. Completed on the caller's thread or later.
   */
  CompletableFuture<Boolean> setIfAbsent(UUID player, Location where);
}
