package com.shepherdjerred.thestorm.towns.domain.parcel;

import java.util.HashSet;
import java.util.List;

/** Strict surveyed land inventory. Unresolved permanent owners remain in staff custody. */
public record ParcelsConfig(List<ParcelDefinition> parcels) {
  public ParcelsConfig {
    parcels = List.copyOf(parcels);
    var ids = new HashSet<String>();
    for (var parcel : parcels) {
      if (!ids.add(parcel.id())) {
        throw new IllegalArgumentException("duplicate parcel " + parcel.id());
      }
    }
    for (var i = 0; i < parcels.size(); i++) {
      for (var j = i + 1; j < parcels.size(); j++) {
        if (parcels.get(i).overlaps(parcels.get(j))) {
          throw new IllegalArgumentException(
              "parcels overlap: " + parcels.get(i).id() + " and " + parcels.get(j).id());
        }
      }
    }
  }
}
