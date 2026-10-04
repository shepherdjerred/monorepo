package com.shepherdjerred.thestorm.towns.app;

import com.shepherdjerred.thestorm.towns.domain.parcel.Lease;
import com.shepherdjerred.thestorm.towns.domain.parcel.ParcelDefinition;
import com.shepherdjerred.thestorm.towns.domain.parcel.ParcelKind;
import com.shepherdjerred.thestorm.towns.domain.parcel.ParcelsConfig;
import com.shepherdjerred.thestorm.towns.domain.parcel.ProtectedParcel;
import com.shepherdjerred.thestorm.towns.domain.region.RegionProfile;
import java.time.InstantSource;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/** Main-thread parcel inventory and leases. Time is evaluated on every protection lookup. */
public final class ParcelBook {
  private final List<ParcelDefinition> definitions;
  private final Map<String, Lease> leases = new HashMap<>();
  private final InstantSource time;
  private final Set<String> busy = new java.util.HashSet<>();
  private final Set<String> prepared = new java.util.HashSet<>();

  public ParcelBook(ParcelsConfig config, InstantSource time) {
    definitions = config.parcels();
    this.time = time;
  }

  public List<ParcelDefinition> definitions() {
    return definitions;
  }

  public Optional<ParcelDefinition> byId(String id) {
    return definitions.stream().filter(def -> def.id().equals(id)).findFirst();
  }

  public void load(List<Lease> loaded) {
    leases.clear();
    for (var lease : loaded) {
      var definition =
          byId(lease.parcelId())
              .orElseThrow(
                  () -> new IllegalStateException("unknown leased plot " + lease.parcelId()));
      if (definition.kind() != ParcelKind.RENTAL_SHOP
          || leases.put(lease.parcelId(), lease) != null) {
        throw new IllegalStateException("invalid lease for " + lease.parcelId());
      }
    }
  }

  public Optional<Lease> lease(String id) {
    return Optional.ofNullable(leases.get(id));
  }

  public void committed(Lease lease) {
    leases.put(lease.parcelId(), lease);
  }

  public void released(String id) {
    leases.remove(id);
  }

  public boolean holdsRental(UUID player) {
    return leases.values().stream().anyMatch(lease -> lease.owner().equals(player));
  }

  public boolean begin(String id) {
    return busy.add(id);
  }

  public boolean prepared(String id) {
    return prepared.contains(id);
  }

  public void baselineReady(String id) {
    prepared.add(id);
  }

  public void end(String id) {
    busy.remove(id);
  }

  public @Nullable ParcelDefinition at(String world, int x, int y, int z) {
    return definitions.stream()
        .filter(def -> def.area().contains(world, x, y, z))
        .findFirst()
        .orElse(null);
  }

  public ProtectedParcel rights(ParcelDefinition def, RegionProfile profile) {
    if (busy.contains(def.id())) {
      return new ProtectedParcel(def, Set.of(), ProtectedParcel.Phase.RESETTING, profile);
    }
    if (def.kind() != ParcelKind.RENTAL_SHOP) {
      return new ProtectedParcel(def, def.owners(), ProtectedParcel.Phase.ACTIVE, profile);
    }
    var lease = leases.get(def.id());
    var phase =
        lease == null
            ? ProtectedParcel.Phase.UNOWNED
            : lease.active(time.instant())
                ? ProtectedParcel.Phase.ACTIVE
                : lease.reclaimable(time.instant())
                    ? ProtectedParcel.Phase.RESETTING
                    : ProtectedParcel.Phase.GRACE;
    return new ProtectedParcel(
        def, lease == null ? Set.of() : Set.of(lease.owner()), phase, profile);
  }
}
