package com.shepherdjerred.thestorm.creative.domain;

import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * One mutable plot row. A blank owner with {@code released} false keeps the catalog owner and only
 * stores a name, description, or trust list. {@code countsTowardCap} is true only for a plot a
 * player claimed themselves. Restored catalog plots and staff assigns do not.
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
    Set<UUID> trusted) {

  public StoredClaim {
    trusted = Set.copyOf(trusted);
  }

  public StoredClaim withTrusted(Set<UUID> members) {
    return new StoredClaim(id, owner, released, countsTowardCap, name, description, members);
  }

  public StoredClaim withText(String nextName, String nextDescription) {
    return new StoredClaim(
        id, owner, released, countsTowardCap, nextName, nextDescription, trusted);
  }
}
