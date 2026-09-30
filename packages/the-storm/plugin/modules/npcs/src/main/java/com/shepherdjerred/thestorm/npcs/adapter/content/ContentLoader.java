package com.shepherdjerred.thestorm.npcs.adapter.content;

import com.shepherdjerred.thestorm.core.config.Problem;
import com.shepherdjerred.thestorm.core.config.StrictYaml;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.npcs.domain.content.Content;
import com.shepherdjerred.thestorm.npcs.domain.content.ContentCompiler;
import com.shepherdjerred.thestorm.npcs.domain.content.ContentCompiler.Sourced;
import com.shepherdjerred.thestorm.npcs.domain.content.ContentFile;
import com.shepherdjerred.thestorm.npcs.domain.content.ContentProblem;
import com.shepherdjerred.thestorm.npcs.domain.content.ContentRules;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * Reads every {@code *.yml} directly inside {@code plugins/TheStorm/npcs/} (the repository owns
 * them) and compiles them into {@link Content}. File I/O: call it at enable or off the main thread.
 */
public final class ContentLoader {

  /** The content directory's name inside the plugin data folder. */
  public static final String DIRECTORY = "npcs";

  private ContentLoader() {}

  /** Reads and validates the content under {@code dataDirectory}. */
  public static Result<Content, List<ContentProblem>> load(Path dataDirectory, ContentRules rules) {
    return read(dataDirectory.resolve(DIRECTORY))
        .flatMap(files -> ContentCompiler.compile(files, rules));
  }

  static Result<List<Sourced>, List<ContentProblem>> read(Path directory) {
    List<Path> paths;
    try (var listing = Files.list(directory)) {
      paths =
          listing
              .filter(
                  path ->
                      Files.isRegularFile(path) && path.getFileName().toString().endsWith(".yml"))
              .sorted()
              .toList();
    } catch (IOException e) {
      return Result.err(
          List.of(new ContentProblem(directory.toString(), "", "cannot list NPC content: " + e)));
    }
    var files = new ArrayList<Sourced>();
    var problems = new ArrayList<ContentProblem>();
    for (var path : paths) {
      var source = DIRECTORY + "/" + path.getFileName();
      String yaml;
      try {
        yaml = Files.readString(path);
      } catch (IOException e) {
        problems.add(new ContentProblem(source, "", "cannot read: " + e));
        continue;
      }
      switch (StrictYaml.parse(source, yaml, ContentFile.class)) {
        case Result.Ok<ContentFile, List<Problem>>(var file) ->
            files.add(new Sourced(source, file));
        case Result.Err<ContentFile, List<Problem>>(var parseProblems) ->
            parseProblems.forEach(
                problem ->
                    problems.add(
                        new ContentProblem(problem.source(), problem.path(), problem.message())));
      }
    }
    return problems.isEmpty() ? Result.ok(files) : Result.err(problems);
  }
}
