package com.shepherdjerred.thestorm.core.config;

import static java.util.stream.Collectors.joining;

import com.shepherdjerred.thestorm.core.result.Result;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

/**
 * Loads repository-owned config and content files at module enable. A missing or invalid file is a
 * deployment error: the module refuses to start rather than run on defaults.
 */
public final class ConfigFiles {

  private ConfigFiles() {}

  /** Reads and strictly parses {@code file} into {@code type}, or throws listing every problem. */
  public static <T> T load(Path file, Class<T> type) {
    String yaml;
    try {
      yaml = Files.readString(file);
    } catch (IOException e) {
      throw new UncheckedIOException("Required file " + file + " could not be read", e);
    }
    return switch (StrictYaml.parse(file.toString(), yaml, type)) {
      case Result.Ok<T, List<Problem>>(var value) -> value;
      case Result.Err<T, List<Problem>>(var problems) ->
          throw new IllegalStateException(
              "Invalid "
                  + file
                  + ":\n"
                  + problems.stream().map(Problem::toString).collect(joining("\n")));
    };
  }
}
