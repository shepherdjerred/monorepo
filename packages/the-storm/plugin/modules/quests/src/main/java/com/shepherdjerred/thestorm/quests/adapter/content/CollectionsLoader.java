package com.shepherdjerred.thestorm.quests.adapter.content;

import com.shepherdjerred.thestorm.core.config.StrictYaml;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.quests.domain.content.Collections;
import com.shepherdjerred.thestorm.quests.domain.content.ContentCompiler;
import com.shepherdjerred.thestorm.quests.domain.content.ContentProblem;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/** Loads and validates the collection catalogue beside quests.yml at module enable. */
public final class CollectionsLoader {

  private static final String SOURCE = "collections.yml";

  private CollectionsLoader() {}

  public record File(Map<String, Entry> collections) {}

  public record Entry(String name, String material, String region, String note) {}

  public static Result<Collections, List<ContentProblem>> load(Path directory, Set<String> items) {
    String yaml;
    try {
      yaml = Files.readString(directory.resolve(SOURCE));
    } catch (IOException failure) {
      return Result.err(List.of(new ContentProblem(SOURCE, "", "cannot read: " + failure)));
    }
    return switch (StrictYaml.parse(SOURCE, yaml, File.class)) {
      case Result.Err<File, List<com.shepherdjerred.thestorm.core.config.Problem>>(var problems) ->
          Result.err(
              problems.stream()
                  .map(
                      problem ->
                          new ContentProblem(problem.source(), problem.path(), problem.message()))
                  .toList());
      case Result.Ok<File, List<com.shepherdjerred.thestorm.core.config.Problem>>(var file) ->
          validate(file, items);
    };
  }

  private static Result<Collections, List<ContentProblem>> validate(File file, Set<String> items) {
    var problems = new ArrayList<ContentProblem>();
    var entries = new TreeMap<String, Collections.Entry>();
    new TreeMap<>(file.collections())
        .forEach(
            (id, entry) -> {
              var path = "collections." + id;
              if (!ContentCompiler.ID.matcher(id).matches()) {
                problems.add(new ContentProblem(SOURCE, path, "invalid collection id"));
              }
              if (entry.name().isBlank() || entry.name().length() > 48) {
                problems.add(new ContentProblem(SOURCE, path + ".name", "must be 1–48 characters"));
              }
              if (!items.contains(entry.material())) {
                problems.add(
                    new ContentProblem(
                        SOURCE, path + ".material", "unknown item " + entry.material()));
              }
              if (entry.region().isBlank() || entry.region().length() > 48) {
                problems.add(
                    new ContentProblem(SOURCE, path + ".region", "must be 1–48 characters"));
              }
              if (entry.note().isBlank() || entry.note().length() > 200) {
                problems.add(
                    new ContentProblem(SOURCE, path + ".note", "must be 1–200 characters"));
              }
              entries.put(
                  id,
                  new Collections.Entry(
                      id, entry.name(), entry.material(), entry.region(), entry.note()));
            });
    return problems.isEmpty()
        ? Result.ok(new Collections(entries))
        : Result.err(List.copyOf(problems));
  }
}
