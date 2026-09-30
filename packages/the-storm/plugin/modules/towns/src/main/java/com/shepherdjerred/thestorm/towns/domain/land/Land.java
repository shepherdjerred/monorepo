package com.shepherdjerred.thestorm.towns.domain.land;

import com.shepherdjerred.thestorm.towns.domain.region.AdminRegion;
import java.util.Optional;

/** What a position resolves to: open wilderness, a town's claim, or an admin region. */
public sealed interface Land {

  /** Nobody owns it; players may do anything the server itself allows. */
  record Wilderness() implements Land {}

  /** A chunk a town has claimed. */
  record TownLand(Claim claim) implements Land {}

  /** Inside an administrator-defined region. Regions take precedence over claims. */
  record RegionLand(AdminRegion region) implements Land {}

  /** Who owns this land, or empty for wilderness. */
  default Optional<Owner> owner() {
    return switch (this) {
      case Wilderness _ -> Optional.empty();
      case TownLand(var claim) -> Optional.of(claim.owner());
      case RegionLand(var region) -> Optional.of(region.owner());
    };
  }

  /** True when both are wilderness or both belong to the same owner. */
  default boolean sameOwnerAs(Land other) {
    return owner().equals(other.owner());
  }
}
