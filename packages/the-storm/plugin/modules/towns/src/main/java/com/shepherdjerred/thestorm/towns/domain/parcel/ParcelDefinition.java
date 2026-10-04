package com.shepherdjerred.thestorm.towns.domain.parcel;

import com.shepherdjerred.thestorm.towns.domain.region.Cuboid;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/** Repository-owned surveyed bounds, corroborated owners and evidence for a holding. */
public record ParcelDefinition(
    String id,
    String name,
    ParcelKind kind,
    Cuboid area,
    Set<UUID> owners,
    String provenance,
    long weeklyRent) {

  private static final Pattern ID = Pattern.compile("[a-z0-9_-]{1,32}");

  public ParcelDefinition {
    owners = Set.copyOf(owners);
    if (!ID.matcher(id).matches() || name.isBlank() || provenance.isBlank()) {
      throw new IllegalArgumentException("a parcel needs a stable id, name and provenance");
    }
    if (weeklyRent < 0 || (kind == ParcelKind.RENTAL_SHOP) != (weeklyRent > 0)) {
      throw new IllegalArgumentException("only rentals have a positive weekly rent");
    }
    if (kind == ParcelKind.RENTAL_SHOP && !owners.isEmpty()) {
      throw new IllegalArgumentException("rental owners are stored in leases, not configuration");
    }
    if (kind != ParcelKind.HERITAGE && volume(area) > 262_144) {
      throw new IllegalArgumentException("shop volume must not exceed 262144 blocks");
    }
  }

  public long buildableArea() {
    return Math.multiplyExact(
        (long) area.to().x() - area.from().x() + 1, (long) area.to().z() - area.from().z() + 1);
  }

  private static long volume(Cuboid area) {
    return Math.multiplyExact(
        Math.multiplyExact(
            (long) area.to().x() - area.from().x() + 1, (long) area.to().z() - area.from().z() + 1),
        (long) area.to().y() - area.from().y() + 1);
  }

  public boolean overlaps(ParcelDefinition other) {
    var a = area;
    var b = other.area;
    return a.world().equals(b.world())
        && a.from().x() <= b.to().x()
        && b.from().x() <= a.to().x()
        && a.from().y() <= b.to().y()
        && b.from().y() <= a.to().y()
        && a.from().z() <= b.to().z()
        && b.from().z() <= a.to().z();
  }
}
