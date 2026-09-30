package com.shepherdjerred.thestorm.shops.domain.catalog;

import com.shepherdjerred.thestorm.core.result.Result;
import java.util.List;
import java.util.function.Predicate;

/**
 * Validates every catalog file together. Each entry has already validated itself while parsing;
 * these rules look across entries and files. Every problem is collected.
 */
public final class CatalogValidator {

  private final List<CatalogRule> rules;

  public CatalogValidator(List<CatalogRule> rules) {
    this.rules = List.copyOf(rules);
  }

  /**
   * The standard rules.
   *
   * @param isItem whether an item key names an item in the running game
   */
  public static CatalogValidator standard(Predicate<String> isItem) {
    return new CatalogValidator(
        List.of(
            new FileNamesMatchIdsRule(),
            new UniqueIdsRule(),
            new UniqueItemsRule(),
            new KnownItemsRule(isItem),
            new NoArbitrageRule()));
  }

  /** The catalogs in file order, or every problem found. */
  public Result<List<Catalog>, List<CatalogProblem>> validate(List<CatalogFile> files) {
    var problems = rules.stream().flatMap(rule -> rule.check(files).stream()).toList();
    return problems.isEmpty()
        ? Result.ok(files.stream().map(CatalogFile::catalog).toList())
        : Result.err(problems);
  }
}
