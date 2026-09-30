package com.shepherdjerred.thestorm.shops.domain.catalog;

import java.util.List;
import java.util.function.Predicate;

/** Every listed item exists in the running game. The adapter supplies the item registry check. */
public final class KnownItemsRule implements CatalogRule {

  private final Predicate<String> isItem;

  /**
   * @param isItem whether an item key (without namespace, such as {@code coal}) names an item
   */
  public KnownItemsRule(Predicate<String> isItem) {
    this.isItem = isItem;
  }

  @Override
  public List<CatalogProblem> check(List<CatalogFile> files) {
    return files.stream()
        .flatMap(
            file ->
                file.catalog().entries().stream()
                    .filter(entry -> !isItem.test(entry.itemKey()))
                    .<CatalogProblem>map(
                        entry ->
                            new CatalogProblem.UnknownItem(file.catalog().id(), entry.itemKey())))
        .toList();
  }
}
