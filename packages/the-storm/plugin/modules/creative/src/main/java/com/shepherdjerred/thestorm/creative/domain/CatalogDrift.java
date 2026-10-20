package com.shepherdjerred.thestorm.creative.domain;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;

/**
 * How the claim store differs from the historical catalog. The report is text only. Nothing here
 * writes {@code creative.yml}.
 */
public final class CatalogDrift {

  private CatalogDrift() {}

  public static List<String> report(PlotCatalog catalog, Collection<StoredClaim> stored) {
    var lines = new ArrayList<String>();
    for (var row : stored) {
      var recovered = catalog.get(row.id());
      if (row.released() && recovered.isPresent()) {
        lines.add(row.id().text() + " released");
      } else if (recovered.isEmpty() && row.owner().isPresent() && row.countsTowardCap()) {
        lines.add(row.id().text() + " new claim " + row.owner().orElseThrow());
      } else if (row.owner().isPresent()
          && recovered.flatMap(RecoveredPlot::ownerId).isPresent()
          && !row.owner().equals(recovered.flatMap(RecoveredPlot::ownerId))) {
        lines.add(row.id().text() + " owner override " + row.owner().orElseThrow());
      }
    }
    return List.copyOf(lines);
  }
}
