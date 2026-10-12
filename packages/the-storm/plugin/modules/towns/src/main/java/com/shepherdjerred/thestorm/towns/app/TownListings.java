package com.shepherdjerred.thestorm.towns.app;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

/** Builds public town summaries from the loaded, in-memory town state. Main thread only. */
public final class TownListings implements TownRead {

  private final TownsState state;

  public TownListings(TownsState state) {
    this.state = state;
  }

  @Override
  public Listing list(int limit) {
    return page(1, limit);
  }

  @Override
  public Listing page(int page, int limit) {
    if (limit < 1 || limit > 25) {
      throw new IllegalArgumentException("town list limit must be 1..25");
    }
    if (page < 1) throw new IllegalArgumentException("town list page must be positive");
    var towns = directory();
    var shown =
        towns.stream()
            .sorted(
                Comparator.comparingInt(
                        (TownSummary town) ->
                            town.name().equals("Spawn")
                                ? 0
                                : town.kind()
                                            == com.shepherdjerred.thestorm.towns.domain.heritage
                                                .HeritageSite.Kind.HERITAGE
                                        && town.name().startsWith("Historic ")
                                    ? 2
                                    : 1)
                    .thenComparing(TownSummary::name, String.CASE_INSENSITIVE_ORDER))
            .skip((long) (page - 1) * limit)
            .limit(limit)
            .toList();
    return new Listing(towns.size(), shown);
  }

  @Override
  public Optional<TownSummary> info(String name) {
    var display =
        state.heritage().sites().stream()
            .filter(site -> site.activeTownName().equalsIgnoreCase(name))
            .map(com.shepherdjerred.thestorm.towns.domain.heritage.HeritageSite::name)
            .findFirst()
            .orElse(name);
    var active = state.named(name);
    if (active.isPresent()) {
      display =
          state.heritage().sites().stream()
              .filter(site -> site.activeTownId().equals(Optional.of(active.orElseThrow().id())))
              .map(com.shepherdjerred.thestorm.towns.domain.heritage.HeritageSite::name)
              .findFirst()
              .orElse(display);
    }
    var requested = display;
    return directory().stream().filter(town -> town.name().equalsIgnoreCase(requested)).findFirst();
  }

  /** Name completion covers the entire directory, including entries after the first page. */
  public List<String> matchingNames(String prefix) {
    var normalized = prefix.toLowerCase(Locale.ROOT);
    return directory().stream()
        .map(TownSummary::name)
        .filter(name -> name.toLowerCase(Locale.ROOT).startsWith(normalized))
        .sorted(String.CASE_INSENSITIVE_ORDER)
        .toList();
  }

  private List<TownSummary> directory() {
    var result = new ArrayList<TownSummary>();
    for (var site : state.heritage().sites()) {
      var town = site.activeTownId().flatMap(state::town);
      result.add(
          new TownSummary(
              site.name(),
              town.map(value -> value.members().size()).orElse(0),
              town.map(value -> state.claimCount(value.id())).orElse(0),
              site.kind(),
              site.footprint().size(),
              site.editors().isEmpty()
                  ? "Staff custody"
                  : String.join(
                          ", ",
                          site.editors().stream()
                              .map(
                                  com.shepherdjerred.thestorm.towns.domain.heritage.HeritageSite
                                          .Editor
                                      ::name)
                              .toList())
                      + " within proven footprint; staff in buffer",
              "Reconstructed from the 2015 archive; original Towny claims unavailable"));
    }
    for (var town : state.towns()) {
      if (state.heritage().sites().stream()
          .noneMatch(site -> site.activeTownId().equals(Optional.of(town.id())))) {
        result.add(
            new TownSummary(town.name(), town.members().size(), state.claimCount(town.id())));
      }
    }
    return List.copyOf(result);
  }
}
