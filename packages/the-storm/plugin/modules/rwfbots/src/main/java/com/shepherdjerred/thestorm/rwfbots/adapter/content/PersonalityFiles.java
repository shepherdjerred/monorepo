package com.shepherdjerred.thestorm.rwfbots.adapter.content;

import static java.util.Objects.requireNonNullElse;
import static java.util.stream.Collectors.joining;

import com.shepherdjerred.thestorm.core.config.Problem;
import com.shepherdjerred.thestorm.core.config.StrictYaml;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Personality;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.PersonalityCatalog;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * Loads every {@code plugins/TheStorm/rwfbots/personalities/<id>.yml} (the repository owns them)
 * into a {@link PersonalityCatalog}. Any problem in any file stops the module and lists everything
 * that is wrong: an unknown key, a bad name, a blank skin, a file whose name is not its id, or two
 * personalities players could confuse. File I/O: call it at enable or off the main thread.
 */
public final class PersonalityFiles {

  /** The content directory inside the plugin data folder. */
  public static final String DIRECTORY = "rwfbots/personalities";

  private PersonalityFiles() {}

  /** Loads the catalog under {@code dataDirectory}, which is {@code plugins/TheStorm}. */
  public static PersonalityCatalog load(Path dataDirectory) {
    return loadDirectory(dataDirectory.resolve(DIRECTORY));
  }

  /** Loads the catalog from the personalities directory itself. */
  public static PersonalityCatalog loadDirectory(Path directory) {
    var problems = new ArrayList<Problem>();
    var personalities = new ArrayList<Personality>();
    var files = list(directory);
    if (files.isEmpty()) {
      throw new IllegalStateException(
          directory + " has no personalities; add at least one <id>.yml");
    }
    for (var file : files) {
      switch (read(file)) {
        case Result.Ok<Personality, List<Problem>>(var personality) ->
            personalities.add(personality);
        case Result.Err<Personality, List<Problem>>(var found) -> problems.addAll(found);
      }
    }
    if (!problems.isEmpty()) {
      throw new IllegalStateException(
          "Invalid rwfbots personalities:\n"
              + problems.stream().map(Problem::toString).collect(joining("\n")));
    }
    try {
      return new PersonalityCatalog(personalities);
    } catch (IllegalArgumentException e) {
      throw new IllegalStateException(
          "Invalid rwfbots personalities in " + directory + ": " + e.getMessage(), e);
    }
  }

  private static List<Path> list(Path directory) {
    try (var listing = Files.list(directory)) {
      return listing
          .filter(
              path -> Files.isRegularFile(path) && path.getFileName().toString().endsWith(".yml"))
          .sorted()
          .toList();
    } catch (IOException e) {
      throw new UncheckedIOException("Required folder " + directory + " could not be read", e);
    }
  }

  /** One file as a personality, or every reason it is not one. */
  static Result<Personality, List<Problem>> read(Path file) {
    var source = DIRECTORY + "/" + file.getFileName();
    String yaml;
    try {
      yaml = Files.readString(file);
    } catch (IOException e) {
      throw new UncheckedIOException("Required file " + file + " could not be read", e);
    }
    return StrictYaml.parse(source, yaml, PersonalityFile.class)
        .flatMap(parsed -> toPersonality(source, file, parsed));
  }

  private static Result<Personality, List<Problem>> toPersonality(
      String source, Path file, PersonalityFile parsed) {
    var expected = parsed.id() + ".yml";
    if (!file.getFileName().toString().equals(expected)) {
      return Result.err(
          List.of(
              new Problem(
                  source,
                  "id",
                  "defines personality " + parsed.id() + "; name the file " + expected)));
    }
    try {
      return Result.ok(parsed.toPersonality());
    } catch (IllegalArgumentException e) {
      return Result.err(
          List.of(new Problem(source, "", requireNonNullElse(e.getMessage(), "invalid"))));
    }
  }
}
