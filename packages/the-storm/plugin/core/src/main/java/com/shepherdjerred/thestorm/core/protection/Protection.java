package com.shepherdjerred.thestorm.core.protection;

import java.util.UUID;
import org.bukkit.Location;

/**
 * Decides whether a player may act at a location. Main thread only: implementations read their
 * claim state from memory.
 */
public interface Protection {

  Decision check(UUID player, ProtectedAction action, Location location);

  /**
   * Decides whether {@code attacker}, standing at {@code attackerAt}, may harm a creature at {@code
   * victimAt}. "Harm" is any effect on the creature, not only damage: potions, freezing, knockback,
   * being moved or trapped, silencing, disarming, setting on fire. Hostile monsters are never
   * protected, so callers do not ask about them.
   */
  Decision checkHarm(UUID attacker, Location attackerAt, HarmTarget target, Location victimAt);

  /**
   * Whether {@code a} and {@code b} lie on land with the same owner: the same town, the same admin
   * region, or both in the wilderness. Used to stop effects that start on one owner's land (such as
   * redstone power) from driving mechanisms on another's.
   */
  boolean sameLand(Location a, Location b);
}
