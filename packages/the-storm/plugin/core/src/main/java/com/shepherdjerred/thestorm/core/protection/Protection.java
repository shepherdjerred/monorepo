package com.shepherdjerred.thestorm.core.protection;

import java.util.Optional;
import java.util.UUID;
import org.bukkit.Location;

/**
 * Decides whether a player may act at a location. Main thread only: implementations read their
 * claim state from memory.
 */
public interface Protection {

  /** Reserved identity for server automation, with no player bypass permissions. */
  UUID SERVER_AUTOMATION = new UUID(0, 0);

  /** The same server identity used by historical public lifts. */
  UUID SERVER_HISTORICAL_LIFT = SERVER_AUTOMATION;

  /** Operator-approved historical gates; distinct from ordinary world automation. */
  UUID SERVER_HISTORICAL_GATE = new UUID(0, 1);

  Decision check(UUID player, ProtectedAction action, Location location);

  /** A proven land editor whose rights an unsigned imported mechanism may use. */
  default Optional<UUID> automationActor(Location location) {
    return Optional.empty();
  }

  /** Checks a bound lift sign. Implementations may allow public lifts in public shop parcels. */
  default Decision checkLift(UUID player, UUID owner, Location location) {
    return check(player, ProtectedAction.INTERACT, location);
  }

  /** Whether a reviewed historical server lift may be bound at this location. */
  default boolean mayBindServerHistoricalLift(Location location) {
    return false;
  }

  /** Whether a specifically surveyed server-owned historical circuit may operate here. */
  default boolean mayOperateServerHistoricalCircuit(Location location) {
    return false;
  }

  /** Exact bound historical gate cells, respecting current ownership and recovery freezes. */
  default boolean mayOperateServerHistoricalGate(Location location) {
    return false;
  }

  /** Trusted, exact-catalog shop restoration only; does not grant any player access. */
  default boolean mayRestoreHistoricalShop(Location location) {
    return false;
  }

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

  /** Whether immutable preservation or an active recovery forbids background block changes. */
  boolean isPreserved(Location location);
}
