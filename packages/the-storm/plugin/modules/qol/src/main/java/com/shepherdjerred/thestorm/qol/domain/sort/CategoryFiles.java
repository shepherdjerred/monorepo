package com.shepherdjerred.thestorm.qol.domain.sort;

import com.shepherdjerred.thestorm.qol.domain.sort.CategoryCatalog.Source;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;

/** Reads the category files in a directory, in file-name order. */
public final class CategoryFiles {

  private CategoryFiles() {}

  /** The catalog in {@code directory}. A missing directory or an empty one fails. */
  public static CategoryCatalog load(Path directory) {
    if (!Files.isDirectory(directory)) {
      throw new IllegalArgumentException("sort categories are missing: " + directory);
    }
    try (var listing = Files.list(directory)) {
      var files =
          listing.filter(path -> path.getFileName().toString().endsWith(".txt")).sorted().toList();
      if (files.isEmpty()) {
        throw new IllegalArgumentException("sort categories are missing: " + directory);
      }
      var sources = new ArrayList<Source>();
      for (var file : files) {
        sources.add(new Source(file.getFileName().toString(), Files.readString(file)));
      }
      return CategoryCatalog.parse(sources);
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }
}
