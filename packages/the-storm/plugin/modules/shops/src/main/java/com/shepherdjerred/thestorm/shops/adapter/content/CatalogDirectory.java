package com.shepherdjerred.thestorm.shops.adapter.content;

import static java.util.stream.Collectors.joining;

import com.shepherdjerred.thestorm.core.config.Problem;
import com.shepherdjerred.thestorm.core.config.StrictYaml;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.shops.domain.catalog.Catalog;
import com.shepherdjerred.thestorm.shops.domain.catalog.CatalogFile;
import com.shepherdjerred.thestorm.shops.domain.catalog.CatalogProblem;
import com.shepherdjerred.thestorm.shops.domain.catalog.CatalogValidator;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Predicate;

/**
 * Loads every catalog in a directory, which the repository owns. A missing directory, an empty one,
 * or any invalid file stops the module with every problem listed; there are no default catalogs.
 */
public final class CatalogDirectory {

  private CatalogDirectory() {}

  /**
   * Parses and validates {@code directory/*.yml}, in file-name order.
   *
   * @param isItem whether an item key names an item in the running game
   */
  public static List<Catalog> load(Path directory, Predicate<String> isItem) {
    var files = yamlFiles(directory);
    if (files.isEmpty()) {
      throw new IllegalStateException("No catalogs in " + directory);
    }
    var parsed = new ArrayList<CatalogFile>();
    var problems = new ArrayList<String>();
    for (var file : files) {
      switch (StrictYaml.parse(file.toString(), read(file), Catalog.class)) {
        case Result.Ok<Catalog, List<Problem>>(var catalog) ->
            parsed.add(new CatalogFile(file.getFileName().toString(), catalog));
        case Result.Err<Catalog, List<Problem>>(var errors) ->
            errors.forEach(problem -> problems.add(problem.toString()));
      }
    }
    if (problems.isEmpty()) {
      switch (CatalogValidator.standard(isItem).validate(parsed)) {
        case Result.Ok<List<Catalog>, List<CatalogProblem>>(var catalogs) -> {
          return catalogs;
        }
        case Result.Err<List<Catalog>, List<CatalogProblem>>(var errors) ->
            errors.forEach(problem -> problems.add(directory + ": " + problem.describe()));
      }
    }
    throw new IllegalStateException(
        "Invalid catalogs:\n" + problems.stream().collect(joining("\n")));
  }

  private static List<Path> yamlFiles(Path directory) {
    try (var entries = Files.list(directory)) {
      return entries
          .filter(path -> path.getFileName().toString().endsWith(".yml"))
          .sorted()
          .toList();
    } catch (IOException e) {
      throw new UncheckedIOException("Required directory " + directory + " could not be read", e);
    }
  }

  private static String read(Path file) {
    try {
      return Files.readString(file);
    } catch (IOException e) {
      throw new UncheckedIOException("Required file " + file + " could not be read", e);
    }
  }
}
