package com.shepherdjerred.thestorm.core.world;

import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.bukkit.Location;
import org.bukkit.World;

/**
 * Worlds the ordinary server rules stay out of. A minigame module seals the world it runs its
 * matches in; every other module asks {@link #isSealed} at event time and leaves that world alone:
 * no land protection or combat locks, no skill XP, no graves, no shard drops, no spells or
 * mechanisms, no mob levelling, no Discord relay, and no teleport into or out of it.
 *
 * <p>Published by the plugin as a core service, so a module may seal a world before or after the
 * modules that honour the seal have enabled. Keyed by world name, like every other per-world
 * setting in the plugin. Safe to call from any thread.
 */
public final class SealedWorlds {

  private final Set<String> sealed = ConcurrentHashMap.newKeySet();

  /** Seals the world named {@code worldName}; sealing twice is harmless. */
  public void seal(String worldName) {
    sealed.add(worldName);
  }

  /** Seals {@code world}. */
  public void seal(World world) {
    seal(world.getName());
  }

  /** Lifts the seal on {@code worldName}; a world that was not sealed stays unsealed. */
  public void unseal(String worldName) {
    sealed.remove(worldName);
  }

  /** Whether the world named {@code worldName} is sealed. */
  public boolean isSealed(String worldName) {
    return sealed.contains(worldName);
  }

  public boolean isSealed(World world) {
    return isSealed(world.getName());
  }

  /** Whether {@code location}'s world is sealed; a location without a world is a caller bug. */
  public boolean isSealed(Location location) {
    var world = location.getWorld();
    if (world == null) {
      throw new IllegalArgumentException("location has no world: " + location);
    }
    return isSealed(world);
  }

  /** The sealed world names, for diagnostics. */
  public Set<String> names() {
    return Set.copyOf(sealed);
  }
}
