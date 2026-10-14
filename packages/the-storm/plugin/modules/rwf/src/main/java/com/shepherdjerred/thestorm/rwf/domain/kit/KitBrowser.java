package com.shepherdjerred.thestorm.rwf.domain.kit;

import static java.util.Comparator.comparing;
import static java.util.Comparator.comparingInt;
import static java.util.Objects.requireNonNull;

import java.util.List;
import java.util.Optional;

/** Pure kit browsing rules, independent of the inventory used to display them. */
public final class KitBrowser {
  private KitBrowser() {}

  public enum Sort {
    ORIGINAL("Original order"),
    NAME("Name"),
    PRICE("Price"),
    TIER("Tier");

    private final String displayName;

    Sort(String displayName) {
      this.displayName = displayName;
    }

    public String displayName() {
      return displayName;
    }
  }

  public enum Access {
    ALL("All kits"),
    AVAILABLE("Available now"),
    OWNED("Owned / always free"),
    ROTATION("Free this week");

    private final String displayName;

    Access(String displayName) {
      this.displayName = displayName;
    }

    public String displayName() {
      return displayName;
    }
  }

  public record Query(int page, Sort sort, Optional<KitCategory> category, Access access) {
    public static final Query DEFAULT = new Query(0, Sort.ORIGINAL, Optional.empty(), Access.ALL);

    public Query {
      if (page < 0) {
        throw new IllegalArgumentException("kit page must not be negative");
      }
      requireNonNull(sort);
      requireNonNull(category);
      requireNonNull(access);
    }

    public Query at(int next) {
      return new Query(next, sort, category, access);
    }

    public Query nextSort() {
      var next =
          switch (sort) {
            case ORIGINAL -> Sort.NAME;
            case NAME -> Sort.PRICE;
            case PRICE -> Sort.TIER;
            case TIER -> Sort.ORIGINAL;
          };
      return new Query(0, next, category, access);
    }

    public Query nextAccess() {
      var next =
          switch (access) {
            case ALL -> Access.AVAILABLE;
            case AVAILABLE -> Access.OWNED;
            case OWNED -> Access.ROTATION;
            case ROTATION -> Access.ALL;
          };
      return new Query(0, sort, category, next);
    }

    public Query nextCategory() {
      var next =
          switch (category.orElse(null)) {
            case null -> Optional.of(KitCategory.CLASSIC);
            case CLASSIC -> Optional.of(KitCategory.RANGED);
            case RANGED -> Optional.of(KitCategory.TACTICAL);
            case TACTICAL -> Optional.<KitCategory>empty();
          };
      return new Query(0, sort, next, access);
    }

    public String categoryLabel() {
      return category.map(KitCategory::displayName).orElse("All categories");
    }

    public List<KitSpec> select(List<KitSpec> kits, KitAccess allowed) {
      var filtered =
          kits.stream()
              .filter(kit -> category.isEmpty() || category.orElseThrow() == kit.category())
              .filter(
                  kit ->
                      switch (access) {
                        case ALL -> true;
                        case AVAILABLE -> allowed.allows(kit);
                        case OWNED ->
                            kit.availability() == KitAvailability.FREE
                                || allowed.owned().contains(kit.id());
                        case ROTATION -> allowed.freeThisWeek().contains(kit.id());
                      });
      var names =
          comparing(KitSpec::name, String.CASE_INSENSITIVE_ORDER).thenComparing(KitSpec::id);
      return switch (sort) {
        case ORIGINAL -> filtered.toList();
        case NAME -> filtered.sorted(names).toList();
        case PRICE -> filtered.sorted(comparingInt(KitSpec::price).thenComparing(names)).toList();
        case TIER -> filtered.sorted(comparing(KitSpec::tier).thenComparing(names)).toList();
      };
    }
  }
}
