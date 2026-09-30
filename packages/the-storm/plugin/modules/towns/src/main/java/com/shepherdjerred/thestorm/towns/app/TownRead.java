package com.shepherdjerred.thestorm.towns.app;

import java.util.List;

/** Read-only, main-thread snapshot of player towns for other modules. */
public interface TownRead {

  /** Alphabetical first page and the total number of towns. Call only on Paper's main thread. */
  Listing list(int limit);

  /** A bounded list with its full count. */
  record Listing(int total, List<TownSummary> towns) {

    public Listing {
      towns = List.copyOf(towns);
    }
  }

  /** Public town facts suitable for a list, without member identities or treasury data. */
  record TownSummary(String name, int members, int claims) {}
}
