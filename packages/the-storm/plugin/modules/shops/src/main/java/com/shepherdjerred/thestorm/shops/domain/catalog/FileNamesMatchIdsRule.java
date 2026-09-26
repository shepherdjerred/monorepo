package com.shepherdjerred.thestorm.shops.domain.catalog;

import java.util.List;

/** {@code baker.yml} holds the catalog with id {@code baker}, so content is easy to find. */
public final class FileNamesMatchIdsRule implements CatalogRule {

  @Override
  public List<CatalogProblem> check(List<CatalogFile> files) {
    return files.stream()
        .filter(file -> !file.fileName().equals(file.catalog().id() + ".yml"))
        .<CatalogProblem>map(
            file -> new CatalogProblem.FileNameMismatch(file.fileName(), file.catalog().id()))
        .toList();
  }
}
