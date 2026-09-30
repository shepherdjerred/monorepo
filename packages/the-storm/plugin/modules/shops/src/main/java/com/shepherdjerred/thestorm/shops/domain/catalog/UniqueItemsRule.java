package com.shepherdjerred.thestorm.shops.domain.catalog;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;

/** A catalog lists each item once, so its prices and daily limit are unambiguous. */
public final class UniqueItemsRule implements CatalogRule {

  @Override
  public List<CatalogProblem> check(List<CatalogFile> files) {
    var problems = new ArrayList<CatalogProblem>();
    for (var file : files) {
      var seen = new HashSet<String>();
      var reported = new HashSet<String>();
      for (var entry : file.catalog().entries()) {
        var key = entry.itemKey();
        if (!seen.add(key) && reported.add(key)) {
          problems.add(new CatalogProblem.DuplicateItem(file.catalog().id(), key));
        }
      }
    }
    return List.copyOf(problems);
  }
}
