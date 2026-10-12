package com.shepherdjerred.thestorm.towns.domain.land;

import com.shepherdjerred.thestorm.towns.domain.parcel.ProtectedParcel;
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

  record ParcelLand(ProtectedParcel parcel) implements Land {}

  /** Durable world work holds an area even against staff bypass until its journal settles. */
  record WorkLand(AdminRegion region) implements Land {}

  /** Mandatory preservation layered over mutable claims, regions and permanent parcels. */
  record HeritageLand(
      com.shepherdjerred.thestorm.towns.domain.heritage.HeritageSite site,
      java.util.Set<java.util.UUID> editors,
      Land underlying)
      implements Land {
    public HeritageLand {
      editors = java.util.Set.copyOf(editors);
    }
  }

  /** Mutable parcel lifecycle remains authoritative beneath the immutable preservation floor. */
  default Land underlyingLand() {
    return this instanceof HeritageLand heritage ? heritage.underlying() : this;
  }

  /** Safe arrival protection also applies to entities whose damage has no attributable actor. */
  default boolean preventsPlayerDamage() {
    return switch (this) {
      case RegionLand(var region) -> region.profile().preventsPlayerDamage();
      case ParcelLand(var parcel) -> parcel.profile().preventsPlayerDamage();
      case HeritageLand(var site, _, _) -> site.profile().preventsPlayerDamage();
      default -> false;
    };
  }

  /** Who owns this land, or empty for wilderness. */
  default Optional<Owner> owner() {
    return switch (this) {
      case Wilderness _ -> Optional.empty();
      case TownLand(var claim) -> Optional.of(claim.owner());
      case RegionLand(var region) -> Optional.of(region.owner());
      case WorkLand(var region) -> Optional.of(region.owner());
      case ParcelLand(var parcel) -> Optional.of(new Owner.OfParcel(parcel.definition().id()));
      case HeritageLand(var site, _, var underlying) ->
          underlying instanceof ParcelLand
              ? underlying.owner()
              : Optional.of(new Owner.OfRegion(site.id()));
    };
  }

  /** True when both are wilderness or both belong to the same owner. */
  default boolean sameOwnerAs(Land other) {
    return owner().equals(other.owner());
  }
}
