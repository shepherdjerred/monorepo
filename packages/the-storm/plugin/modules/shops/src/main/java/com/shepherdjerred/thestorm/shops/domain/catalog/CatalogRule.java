package com.shepherdjerred.thestorm.shops.domain.catalog;

import java.util.List;

/** One rule every catalog file, taken together with the others, must follow. */
@FunctionalInterface
public interface CatalogRule {

  List<CatalogProblem> check(List<CatalogFile> files);
}
