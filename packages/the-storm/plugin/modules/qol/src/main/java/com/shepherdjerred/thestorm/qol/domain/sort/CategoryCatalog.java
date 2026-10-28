package com.shepherdjerred.thestorm.qol.domain.sort;

import java.util.ArrayList;
import java.util.List;

/**
 * Groups item keys into ordered categories. A pattern may start or end with {@code *}, not both in
 * a way that puts a star in the middle of the text ({@code a*b*c} is rejected). The first matching
 * category wins. An item that matches none sorts after every category.
 */
public final class CategoryCatalog {

  /** Sorts after every real category. */
  public static final int UNCATEGORIZED_RANK = Integer.MAX_VALUE;

  private final List<Category> categories;

  private CategoryCatalog(List<Category> categories) {
    this.categories = List.copyOf(categories);
  }

  /**
   * One category file.
   *
   * @param name file name without the extension, used only to tell files apart
   * @param body the file text
   */
  public record Source(String name, String body) {

    public Source {
      if (name.isBlank()) {
        throw new IllegalArgumentException("a category file needs a name");
      }
    }
  }

  /** Where an item sits: its category, and its line inside a sticky category. */
  public record Placement(int category, int stickyRank) {}

  /** Parses {@code sources} in the order given. A blank body or a star in the middle fails. */
  public static CategoryCatalog parse(List<Source> sources) {
    if (sources.isEmpty()) {
      throw new IllegalArgumentException("at least one category file is required");
    }
    var categories = new ArrayList<Category>();
    for (var source : sources) {
      categories.add(parseOne(source));
    }
    return new CategoryCatalog(categories);
  }

  /**
   * Where {@code materialKey} sorts. {@code materialKey} is {@code minecraft:oak_log} or {@code
   * oak_log}.
   */
  public Placement place(String materialKey) {
    var name = itemName(materialKey);
    for (var i = 0; i < categories.size(); i++) {
      var category = categories.get(i);
      for (var rule : category.rules) {
        if (rule.matches(name)) {
          return new Placement(i, category.sticky ? rule.rank : UNCATEGORIZED_RANK);
        }
      }
    }
    return new Placement(categories.size(), UNCATEGORIZED_RANK);
  }

  private static String itemName(String materialKey) {
    var colon = materialKey.lastIndexOf(':');
    var name = colon < 0 ? materialKey : materialKey.substring(colon + 1);
    if (name.isBlank()) {
      throw new IllegalArgumentException("not an item key: " + materialKey);
    }
    return name;
  }

  private static Category parseOne(Source source) {
    var sticky = false;
    var rules = new ArrayList<Rule>();
    var rank = 0;
    for (var raw : source.body().split("\n", -1)) {
      var line = raw.strip();
      if (line.isEmpty() || line.startsWith("#")) {
        continue;
      }
      if (line.startsWith("sticky=")) {
        sticky =
            switch (line.substring("sticky=".length()).strip()) {
              case "true" -> true;
              case "false" -> false;
              default -> throw new IllegalArgumentException(source.name() + " has sticky=" + line);
            };
        continue;
      }
      rules.add(Rule.parse(source.name(), line, rank));
      rank++;
    }
    if (rules.isEmpty()) {
      throw new IllegalArgumentException(source.name() + " lists no items");
    }
    return new Category(sticky, List.copyOf(rules));
  }

  private record Category(boolean sticky, List<Rule> rules) {}

  private record Rule(Kind kind, String text, int rank) {

    private enum Kind {
      EXACT,
      PREFIX,
      SUFFIX,
      CONTAINS
    }

    private static Rule parse(String file, String pattern, int rank) {
      var start = pattern.startsWith("*");
      var end = pattern.endsWith("*");
      var core = pattern.substring(start ? 1 : 0, pattern.length() - (end ? 1 : 0));
      if (core.isEmpty() || core.indexOf('*') >= 0) {
        throw new IllegalArgumentException(file + " has a bad pattern: " + pattern);
      }
      var kind =
          switch (start ? 1 : 0) {
            case 0 -> end ? Kind.PREFIX : Kind.EXACT;
            default -> end ? Kind.CONTAINS : Kind.SUFFIX;
          };
      return new Rule(kind, core, rank);
    }

    private boolean matches(String name) {
      return switch (kind) {
        case EXACT -> name.equals(text);
        case PREFIX -> name.startsWith(text);
        case SUFFIX -> name.endsWith(text);
        case CONTAINS -> name.contains(text);
      };
    }
  }
}
