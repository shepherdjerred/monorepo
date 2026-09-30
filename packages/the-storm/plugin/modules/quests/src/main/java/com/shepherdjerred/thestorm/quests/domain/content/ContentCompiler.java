package com.shepherdjerred.thestorm.quests.domain.content;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.quests.domain.board.Template;
import com.shepherdjerred.thestorm.quests.domain.content.ContentFile.QuestEntry;
import com.shepherdjerred.thestorm.quests.domain.content.ContentFile.StageEntry;
import com.shepherdjerred.thestorm.quests.domain.content.ContentFile.TemplateEntry;
import com.shepherdjerred.thestorm.quests.domain.model.Faction;
import com.shepherdjerred.thestorm.quests.domain.model.Quest;
import com.shepherdjerred.thestorm.quests.domain.model.Region;
import com.shepherdjerred.thestorm.quests.domain.model.Stage;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.TreeMap;
import java.util.function.Function;
import java.util.function.Supplier;
import java.util.regex.Pattern;

/**
 * Turns content files into {@link QuestContent}: ids unique across files, every line of the content
 * languages parsed, and records built. Every problem is reported, never just the first.
 */
public final class ContentCompiler {

  /** Ids of quests, stages, factions, variables, regions, hooks and templates. */
  public static final Pattern ID = Pattern.compile("[a-z0-9][a-z0-9_-]*");

  /** Written for an optional value that is absent. */
  public static final String NONE = "none";

  /** A parsed file and where it came from. */
  public record Sourced(String source, ContentFile file) {}

  private final List<ContentProblem> problems = new ArrayList<>();
  private final Map<String, String> owners = new HashMap<>();

  private ContentCompiler() {}

  /** Compiles {@code files} together. */
  public static Result<QuestContent, List<ContentProblem>> compile(List<Sourced> files) {
    var compiler = new ContentCompiler();
    var content = compiler.run(files);
    return compiler.problems.isEmpty() ? Result.ok(content) : Result.err(compiler.problems);
  }

  private QuestContent run(List<Sourced> files) {
    var quests = new TreeMap<String, Quest>();
    var factions = new TreeMap<String, Faction>();
    var variables = new TreeMap<String, String>();
    var regions = new TreeMap<String, Region>();
    var hooks = new TreeMap<String, String>();
    var templates = new TreeMap<String, Template>();
    var sources = new TreeMap<String, String>();
    for (var sourced : files) {
      var source = sourced.source();
      var file = sourced.file();
      file.factions()
          .forEach(
              (id, entry) ->
                  claim(source, "factions", id)
                      .flatMap(
                          path ->
                              build(
                                  source,
                                  path,
                                  () ->
                                      new Faction(
                                          id,
                                          entry.name(),
                                          entry.ranks().stream()
                                              .map(
                                                  rank ->
                                                      new Faction.Rank(rank.name(), rank.from()))
                                              .toList())))
                      .ifPresent(faction -> factions.put(id, faction)));
      describe(source, "variables", file.variables(), variables);
      describe(source, "hooks", file.hooks(), hooks);
      file.regions()
          .forEach(
              (id, entry) ->
                  claim(source, "regions", id)
                      .flatMap(
                          path ->
                              build(
                                  source,
                                  path,
                                  () ->
                                      new Region(
                                          id,
                                          entry.name(),
                                          entry.world(),
                                          entry.x(),
                                          entry.y(),
                                          entry.z(),
                                          entry.radius())))
                      .ifPresent(region -> regions.put(id, region)));
      file.quests()
          .forEach(
              (id, entry) ->
                  claim(source, "quests", id)
                      .flatMap(path -> quest(source, path, id, entry))
                      .ifPresent(
                          quest -> {
                            quests.put(id, quest);
                            sources.put(id, source);
                          }));
      file.templates()
          .forEach(
              (id, entry) ->
                  claim(source, "templates", id)
                      .flatMap(path -> template(source, path, id, entry))
                      .ifPresent(
                          template -> {
                            templates.put(id, template);
                            sources.put(id, source);
                          }));
    }
    return new QuestContent(quests, factions, variables, regions, hooks, templates, sources);
  }

  /** Registers id {@code id} of {@code kind}; empty (and a problem) if taken or malformed. */
  private Optional<String> claim(String source, String kind, String id) {
    var path = kind + "." + id;
    if (!ID.matcher(id).matches()) {
      problem(source, path, "ids are lowercase letters, digits, - and _");
      return Optional.empty();
    }
    var previous = owners.putIfAbsent(kind + ":" + id, source);
    if (previous != null) {
      problem(source, path, "already defined in " + previous);
      return Optional.empty();
    }
    return Optional.of(path);
  }

  private void describe(
      String source, String kind, Map<String, String> entries, Map<String, String> into) {
    entries.forEach(
        (id, description) ->
            claim(source, kind, id)
                .ifPresent(
                    path -> {
                      if (description.isBlank()) {
                        problem(source, path, "needs a description");
                      } else {
                        into.put(id, description);
                      }
                    }));
  }

  private Optional<Quest> quest(String source, String path, String id, QuestEntry entry) {
    var before = problems.size();
    var category = enumValue(source, path + ".category", entry.category(), Quest.Category.class);
    var repeat = enumValue(source, path + ".repeat", entry.repeat(), Quest.Repeat.class);
    var requirements = lines(source, path + ".requirements", entry.requirements(), Dsl::condition);
    var onAccept = lines(source, path + ".onAccept", entry.onAccept(), Dsl::action);
    var rewards = lines(source, path + ".rewards", entry.rewards(), Dsl::action);
    var stages = new HashMap<String, Stage>();
    entry
        .stages()
        .forEach(
            (stageId, stageEntry) ->
                stage(source, path + ".stages." + stageId, stageId, stageEntry)
                    .ifPresent(stage -> stages.put(stageId, stage)));
    if (problems.size() > before || category.isEmpty() || repeat.isEmpty()) {
      return Optional.empty();
    }
    var text = entry.text();
    return build(
        source,
        path,
        () ->
            new Quest(
                id,
                entry.name(),
                entry.giver(),
                category.get(),
                repeat.get(),
                entry.estimatedMinutes(),
                requirements,
                new Quest.QuestText(
                    text.offer(),
                    text.accept(),
                    text.decline(),
                    text.finish(),
                    text.summary(),
                    text.questions().stream()
                        .map(question -> new Quest.Question(question.label(), question.answer()))
                        .toList()),
                entry.start(),
                stages,
                onAccept,
                rewards));
  }

  private Optional<Stage> stage(String source, String path, String id, StageEntry entry) {
    if (!ID.matcher(id).matches()) {
      problem(source, path, "stage ids are lowercase letters, digits, - and _");
      return Optional.empty();
    }
    if (Stage.COMPLETE.equals(id) || Stage.FAIL.equals(id)) {
      problem(source, path, "complete and fail are reserved targets, not stage ids");
      return Optional.empty();
    }
    var before = problems.size();
    var objectives = lines(source, path + ".objectives", entry.objectives(), Dsl::objective);
    var onComplete = lines(source, path + ".onComplete", entry.onComplete(), Dsl::action);
    var next = next(source, path + ".next", entry);
    var limit =
        switch (Dsl.timeLimit(entry.timeLimit())) {
          case Result.Ok<Optional<Stage.TimeLimit>, String>(var value) -> value;
          case Result.Err<Optional<Stage.TimeLimit>, String>(var message) -> {
            problem(source, path + ".timeLimit", message);
            yield Optional.<Stage.TimeLimit>empty();
          }
        };
    if (problems.size() > before || next.isEmpty()) {
      return Optional.empty();
    }
    return build(
        source,
        path,
        () ->
            new Stage(
                id,
                entry.journal(),
                optional(entry.waiting()),
                optional(entry.complete()),
                objectives,
                onComplete,
                next.get(),
                limit));
  }

  private Optional<Stage.Next> next(String source, String path, StageEntry entry) {
    var branches = entry.next();
    if (branches.isEmpty()) {
      problem(source, path, "a stage needs at least one branch (use `to: complete` to finish)");
      return Optional.empty();
    }
    var labelled = branches.stream().filter(branch -> !NONE.equals(branch.label())).count();
    if (labelled == 0) {
      var guarded = new ArrayList<Stage.Branch>();
      for (var index = 0; index < branches.size(); index++) {
        var branch = branches.get(index);
        guarded.add(
            new Stage.Branch(
                branch.to(),
                lines(source, path + "[" + index + "].when", branch.when(), Dsl::condition)));
      }
      return Optional.of(new Stage.Next.Guarded(guarded));
    }
    if (labelled != branches.size()) {
      problem(source, path, "branches are either all choices (with labels) or all guarded");
      return Optional.empty();
    }
    if (branches.stream().anyMatch(branch -> !branch.when().isEmpty())) {
      problem(source, path, "choices cannot have conditions");
      return Optional.empty();
    }
    return Optional.of(
        new Stage.Next.Choice(
            branches.stream()
                .map(branch -> new Stage.Option(branch.label(), branch.to()))
                .toList()));
  }

  private Optional<Template> template(String source, String path, String id, TemplateEntry entry) {
    var period = enumValue(source, path + ".period", entry.period(), Template.Period.class);
    var kind = enumValue(source, path + ".kind", entry.kind(), Template.Kind.class);
    if (period.isEmpty() || kind.isEmpty()) {
      return Optional.empty();
    }
    return build(
        source,
        path,
        () ->
            new Template(
                id,
                period.get(),
                kind.get(),
                entry.name(),
                entry.offer(),
                entry.accept(),
                entry.decline(),
                entry.finish(),
                entry.baseReward(),
                entry.targets().stream()
                    .map(
                        target ->
                            new Template.Target(
                                target.id(),
                                target.difficulty(),
                                target.min(),
                                target.max(),
                                target.reward(),
                                target.minutes()))
                    .toList()));
  }

  private <T> List<T> lines(
      String source, String path, List<String> lines, Function<String, Result<T, String>> parse) {
    var parsed = new ArrayList<T>();
    for (var index = 0; index < lines.size(); index++) {
      switch (parse.apply(lines.get(index))) {
        case Result.Ok<T, String>(var value) -> parsed.add(value);
        case Result.Err<T, String>(var message) ->
            problem(source, path + "[" + index + "]", message);
      }
    }
    return parsed;
  }

  private <E extends Enum<E>> Optional<E> enumValue(
      String source, String path, String value, Class<E> type) {
    try {
      return Optional.of(Enum.valueOf(type, value.toUpperCase(Locale.ROOT).replace('-', '_')));
    } catch (IllegalArgumentException e) {
      problem(source, path, "unknown value " + value);
      return Optional.empty();
    }
  }

  private <T> Optional<T> build(String source, String path, Supplier<T> constructor) {
    try {
      return Optional.of(constructor.get());
    } catch (IllegalArgumentException e) {
      problem(source, path, Objects.requireNonNullElse(e.getMessage(), "invalid"));
      return Optional.empty();
    }
  }

  private static Optional<String> optional(String value) {
    return NONE.equals(value) ? Optional.empty() : Optional.of(value);
  }

  private void problem(String source, String path, String message) {
    problems.add(new ContentProblem(source, path, message));
  }
}
