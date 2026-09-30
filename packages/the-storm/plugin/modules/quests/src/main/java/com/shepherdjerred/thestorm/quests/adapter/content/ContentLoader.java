package com.shepherdjerred.thestorm.quests.adapter.content;

import com.shepherdjerred.thestorm.core.config.Problem;
import com.shepherdjerred.thestorm.core.config.StrictYaml;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.quests.domain.content.ContentCheck;
import com.shepherdjerred.thestorm.quests.domain.content.ContentCompiler;
import com.shepherdjerred.thestorm.quests.domain.content.ContentCompiler.Sourced;
import com.shepherdjerred.thestorm.quests.domain.content.ContentFile;
import com.shepherdjerred.thestorm.quests.domain.content.ContentProblem;
import com.shepherdjerred.thestorm.quests.domain.content.QuestContent;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;

/**
 * Reads every {@code *.yml} under {@code plugins/TheStorm/quests/} (subfolders included; the
 * repository owns them), compiles them and runs the content linter. File I/O: call it at enable or
 * off the main thread.
 */
public final class ContentLoader {

  /** The content directory's name inside the plugin data folder. */
  public static final String DIRECTORY = "quests";

  private ContentLoader() {}

  /** Reads, compiles and checks the content under {@code dataDirectory}. */
  public static Result<QuestContent, List<ContentProblem>> load(
      Path dataDirectory, ContentCheck.Rules rules) {
    return read(dataDirectory.resolve(DIRECTORY))
        .flatMap(ContentCompiler::compile)
        .flatMap(
            content -> {
              var problems = ContentCheck.problems(content, rules);
              return problems.isEmpty() ? Result.ok(content) : Result.err(problems);
            });
  }

  static Result<List<Sourced>, List<ContentProblem>> read(Path directory) {
    List<Path> paths;
    try (Stream<Path> walk = Files.walk(directory)) {
      paths =
          walk.filter(
                  path ->
                      Files.isRegularFile(path) && path.getFileName().toString().endsWith(".yml"))
              .sorted()
              .toList();
    } catch (IOException e) {
      return Result.err(
          List.of(new ContentProblem(directory.toString(), "", "cannot list quest content: " + e)));
    }
    var files = new ArrayList<Sourced>();
    var problems = new ArrayList<ContentProblem>();
    for (var path : paths) {
      var source = DIRECTORY + "/" + directory.relativize(path).toString().replace('\\', '/');
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
