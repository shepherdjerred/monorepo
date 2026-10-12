package com.shepherdjerred.thestorm.towns.app;

import java.util.List;
import java.util.Optional;

/** Read-only, main-thread snapshot of player towns for other modules. */
public interface TownRead {

  /** Alphabetical first page and the total number of towns. Call only on Paper's main thread. */
  Listing list(int limit);

  /** Bounded public directory, with one-based pages and multiword display-name lookup. */
  Listing page(int page, int limit);

  Optional<TownSummary> info(String name);

  /** A bounded list with its full count. */
  record Listing(int total, List<TownSummary> towns) {

    public Listing {
      towns = List.copyOf(towns);
    }
  }

  /** Public town facts suitable for a list, without member identities or treasury data. */
  record TownSummary(
      String name,
      int members,
      int claims,
      com.shepherdjerred.thestorm.towns.domain.heritage.HeritageSite.Kind kind,
      int protectedChunks,
      String custody,
      String boundaries) {
    public TownSummary(String name, int members, int claims) {
      this(
          name,
          members,
          claims,
          com.shepherdjerred.thestorm.towns.domain.heritage.HeritageSite.Kind.PLAYER,
          0,
          "Player town",
          "Player claims");
    }
  }
}
