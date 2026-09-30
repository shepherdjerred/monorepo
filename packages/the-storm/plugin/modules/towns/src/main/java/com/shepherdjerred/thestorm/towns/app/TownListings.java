package com.shepherdjerred.thestorm.towns.app;

import com.shepherdjerred.thestorm.towns.domain.town.Town;
import java.util.Comparator;

/** Builds public town summaries from the loaded, in-memory town state. Main thread only. */
public final class TownListings implements TownRead {

  private final TownsState state;

  public TownListings(TownsState state) {
    this.state = state;
  }

  @Override
  public Listing list(int limit) {
    if (limit < 1 || limit > 25) {
      throw new IllegalArgumentException("town list limit must be 1..25");
    }
    var towns = state.towns();
    var shown =
        towns.stream()
            .sorted(Comparator.comparing(Town::name, String.CASE_INSENSITIVE_ORDER))
            .limit(limit)
            .map(
                town ->
                    new TownSummary(
                        town.name(), town.members().size(), state.claimCount(town.id())))
            .toList();
    return new Listing(towns.size(), shown);
  }
}
