package com.shepherdjerred.thestorm.creative.domain;

import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Membership from the historical catalog. A blank owner is staff-held. Trust was not on the 2016
 * signs, so that set stays empty until a later claim store adds it.
 */
public record CatalogMembership(PlotCatalog catalog) implements PlotMembership {

  @Override
  public Optional<UUID> owner(PlotId id) {
    return catalog.get(id).flatMap(RecoveredPlot::ownerId);
  }

  @Override
  public Map<UUID, PlotRole> access(PlotId id) {
    return Map.of();
  }
}
