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
 * wall, and biome. An empty field keeps the generator default. {@code cluster} is the anchor plot
 * when this plot is merged, and empty when it stands alone. {@code staffHeld} keeps a plot with
 * staff after it moves onto a cell the catalog still names.
 *
 * @param owner an override, when this row names someone
 * @param released an admin unclaim, which hides a catalog owner without editing the catalog
 * @param staffHeld this row is staff-held even when the catalog names an owner
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
    PlotSurface surface,
    Optional<PlotId> cluster,
    boolean staffHeld) {

  public StoredClaim {
    access = Map.copyOf(access);
    flags = Set.copyOf(flags);
    Objects.requireNonNull(surface);
    Objects.requireNonNull(cluster);
  }

  public StoredClaim withAccess(Map<UUID, PlotRole> members) {
    return new StoredClaim(
        id,
        owner,
        released,
        countsTowardCap,
        name,
        description,
        members,
        flags,
        surface,
        cluster,
        staffHeld);
  }

  public StoredClaim withText(String nextName, String nextDescription) {
    return new StoredClaim(
        id,
        owner,
        released,
        countsTowardCap,
        nextName,
        nextDescription,
        access,
        flags,
        surface,
        cluster,
        staffHeld);
  }

  public StoredClaim withFlags(Set<PlotFlag> next) {
    return new StoredClaim(
        id,
        owner,
        released,
        countsTowardCap,
        name,
        description,
        access,
        next,
        surface,
        cluster,
        staffHeld);
  }

  public StoredClaim withSurface(PlotSurface next) {
    return new StoredClaim(
        id,
        owner,
        released,
        countsTowardCap,
        name,
        description,
        access,
        flags,
        next,
        cluster,
        staffHeld);
  }

  public StoredClaim withCluster(Optional<PlotId> next) {
    return new StoredClaim(
        id,
        owner,
        released,
        countsTowardCap,
        name,
        description,
        access,
        flags,
        surface,
        next,
        staffHeld);
  }
}
