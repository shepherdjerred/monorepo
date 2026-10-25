package com.shepherdjerred.thestorm.creative.domain;

import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * One mutable plot row. A blank owner with {@code released} false keeps the catalog owner and only
 * stores a name, description, or access list. {@code countsTowardCap} is true only for a plot a
 * player claimed themselves. Restored catalog plots and staff assigns do not. A player appears in
 * {@code access} at most once, as a member, trusted, or denied. {@code flags} lists the visitor
 * permissions that are on. An empty set leaves every flag off. {@code surface} stores a floor,
 * wall, and biome. An empty field keeps the generator default.
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
    Map<UUID, PlotRole> access,
    Set<PlotFlag> flags,
    PlotSurface surface) {

  public StoredClaim {
    access = Map.copyOf(access);
    flags = Set.copyOf(flags);
    Objects.requireNonNull(surface);
  }

  public StoredClaim withAccess(Map<UUID, PlotRole> members) {
    return new StoredClaim(
        id, owner, released, countsTowardCap, name, description, members, flags, surface);
  }

  public StoredClaim withText(String nextName, String nextDescription) {
    return new StoredClaim(
        id, owner, released, countsTowardCap, nextName, nextDescription, access, flags, surface);
  }

  public StoredClaim withFlags(Set<PlotFlag> next) {
    return new StoredClaim(
        id, owner, released, countsTowardCap, name, description, access, next, surface);
  }

  public StoredClaim withSurface(PlotSurface next) {
    return new StoredClaim(
        id, owner, released, countsTowardCap, name, description, access, flags, next);
  }
}
