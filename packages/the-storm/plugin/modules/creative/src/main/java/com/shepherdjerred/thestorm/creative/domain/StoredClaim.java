package com.shepherdjerred.thestorm.creative.domain;

import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * One mutable plot row. A blank owner with {@code released} false keeps the catalog owner and only
 * stores a name, description, or access list. {@code countsTowardCap} is true only for a plot a
 * player claimed themselves. Restored catalog plots and staff assigns do not. A player appears in
 * {@code access} at most once, as a member, trusted, or denied.
 *
 * @param owner an override, when this row names someone
 * @param released an admin unclaim, which hides a catalog owner without editing the catalog
 */
public record StoredClaim(
    PlotId id,
    Optional<UUID> owner,
    boolean released,
    boolean countsTowardCap,
    String name,
    String description,
    Map<UUID, PlotRole> access) {

  public StoredClaim {
    access = Map.copyOf(access);
  }

  public StoredClaim withAccess(Map<UUID, PlotRole> members) {
    return new StoredClaim(id, owner, released, countsTowardCap, name, description, members);
  }

  public StoredClaim withText(String nextName, String nextDescription) {
    return new StoredClaim(id, owner, released, countsTowardCap, nextName, nextDescription, access);
  }
}
