package com.shepherdjerred.thestorm.shops.domain.catalog;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Every catalog id is used once, since NPCs open catalogs by id. */
public final class UniqueIdsRule implements CatalogRule {

  @Override
  public List<CatalogProblem> check(List<CatalogFile> files) {
    var counts = new LinkedHashMap<String, Integer>();
    for (var file : files) {
      counts.merge(file.catalog().id(), 1, Integer::sum);
    }
    return counts.entrySet().stream()
        .filter(entry -> entry.getValue() > 1)
        .map(Map.Entry::getKey)
        .<CatalogProblem>map(CatalogProblem.DuplicateId::new)
        .toList();
  }
}
