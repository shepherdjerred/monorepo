package com.shepherdjerred.thestorm.quests.adapter.content;

import static java.util.Collections.newSetFromMap;

import com.bladecoder.ink.compiler.Compiler;
import com.bladecoder.ink.compiler.IFileHandler;
import com.bladecoder.ink.runtime.ChoicePoint;
import com.bladecoder.ink.runtime.Container;
import com.bladecoder.ink.runtime.Error.ErrorType;
import com.bladecoder.ink.runtime.Story;
import com.shepherdjerred.thestorm.quests.app.QuestTextRenderer;
import com.shepherdjerred.thestorm.quests.domain.content.QuestContent;
import com.shepherdjerred.thestorm.quests.domain.engine.QuestEngine;
import com.shepherdjerred.thestorm.quests.domain.engine.QuestEngine.Context;
import com.shepherdjerred.thestorm.quests.domain.state.PlayerQuests;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.IdentityHashMap;
import java.util.Map;
import java.util.Set;
import java.util.stream.Stream;

/** Compiled Ink dialogue fragments, loaded once from repository-owned quest content at startup. */
public final class InkDialogue implements QuestTextRenderer {

  private static final String PREFIX = "ink:";
  private static final int MAX_TEXT = 600;
  private static final int MAX_LINES = 32;

  private final Map<String, String> scripts;

  private InkDialogue(Map<String, String> scripts) {
    this.scripts = Map.copyOf(scripts);
  }

  /** Compiles all {@code quests/dialogue/*.ink} files and validates every authored reference. */
  public static InkDialogue load(Path dataDirectory, QuestContent content) {
    var directory = dataDirectory.resolve(ContentLoader.DIRECTORY).resolve("dialogue");
    var scripts = new HashMap<String, String>();
    if (Files.exists(directory)) {
      try (Stream<Path> paths = Files.walk(directory)) {
        for (var path :
            paths.filter(Files::isRegularFile).filter(InkDialogue::isInk).sorted().toList()) {
          var name = directory.relativize(path).toString().replace('\\', '/');
          var key = name.substring(0, name.length() - ".ink".length());
          scripts.put(key, compile(path));
        }
      } catch (IOException exception) {
        throw new IllegalStateException("Cannot list Ink dialogue in " + directory, exception);
      }
    }
    var dialogue = new InkDialogue(scripts);
    content
        .quests()
        .values()
        .forEach(
            quest -> {
              dialogue.check(quest.text().offer());
              dialogue.check(quest.text().accept());
              dialogue.check(quest.text().decline());
              dialogue.check(quest.text().finish());
              quest.text().questions().forEach(question -> dialogue.check(question.answer()));
              quest
                  .stages()
                  .values()
                  .forEach(
                      stage -> {
                        stage.waiting().ifPresent(dialogue::check);
                        stage.complete().ifPresent(dialogue::check);
                      });
            });
    content
        .templates()
        .values()
        .forEach(
            template -> {
              if (template.offer().startsWith(PREFIX)) {
                throw new IllegalStateException(
                    "Ink board offer is unsupported because board amount and target are interpolated: "
                        + template.id());
              }
              dialogue.check(template.accept());
              dialogue.check(template.decline());
              dialogue.check(template.finish());
            });
    return dialogue;
  }

  private static boolean isInk(Path path) {
    return path.getFileName().toString().endsWith(".ink");
  }

  private static String compile(Path path) {
    try {
      var options = new Compiler.Options();
      options.sourceFilename = path.toString();
      options.countAllVisits = true;
      var errors = new ArrayList<String>();
      options.errorHandler =
          (message, type) -> {
            if (type == ErrorType.Error || type == ErrorType.Warning) {
              errors.add(message);
            }
          };
      options.fileHandler = new NoIncludes(path.toString());
      var story = new Compiler(Files.readString(path), options).compile();
      if (story == null || !errors.isEmpty()) {
        throw new IllegalStateException("Invalid Ink dialogue " + path + ": " + errors);
      }
      if (hasChoices(story.getMainContentContainer(), newSetFromMap(new IdentityHashMap<>()))) {
        throw new IllegalStateException("Ink dialogue cannot contain choices: " + path);
      }
      return story.toJson();
    } catch (Exception exception) {
      throw new IllegalStateException("Cannot compile Ink dialogue " + path, exception);
    }
  }

  private static boolean hasChoices(Container container, Set<Container> visited) {
    if (!visited.add(container)) {
      return false;
    }
    for (var child : container.getContent()) {
      if (child instanceof ChoicePoint
          || (child instanceof Container nested && hasChoices(nested, visited))) {
        return true;
      }
    }
    for (var child : container.getNamedContent().values()) {
      if (child instanceof Container nested && hasChoices(nested, visited)) {
        return true;
      }
    }
    return false;
  }

  private void check(String source) {
    if (!source.startsWith(PREFIX)) {
      return;
    }
    var reference = reference(source);
    try {
      new Story(scripts.get(reference.script())).choosePathString(reference.knot());
    } catch (Exception exception) {
      throw new IllegalStateException("Invalid Ink dialogue reference " + source, exception);
    }
  }

  @Override
  public String render(String source, PlayerQuests state, Context context) {
    if (!source.startsWith(PREFIX)) {
      return source;
    }
    var reference = reference(source);
    try {
      var story = new Story(scripts.get(reference.script()));
      bind(story, state, context);
      story.choosePathString(reference.knot());
      var lines = new ArrayList<String>();
      while (story.canContinue()) {
        if (lines.size() == MAX_LINES) {
          throw new IllegalStateException(
              "Ink dialogue exceeds " + MAX_LINES + " lines: " + source);
        }
        var line = story.Continue().strip();
        if (!line.isEmpty()) {
          lines.add(line);
        }
      }
      if (!story.getCurrentChoices().isEmpty()) {
        throw new IllegalStateException("Ink dialogue must end without choices: " + source);
      }
      var text = String.join("\n", lines);
      if (text.isBlank() || text.length() > MAX_TEXT) {
        throw new IllegalStateException(
            "Ink dialogue must render 1.." + MAX_TEXT + " characters: " + source);
      }
      return text;
    } catch (Exception exception) {
      throw new IllegalStateException("Cannot render Ink dialogue " + source, exception);
    }
  }

  private static void bind(Story story, PlayerQuests state, Context context) throws Exception {
    story.bindExternalFunction(
        "quest_active", args -> state.active(argument(args)).isPresent(), true);
    story.bindExternalFunction(
        "quest_completed", args -> state.completion(argument(args)).isPresent(), true);
    story.bindExternalFunction(
        "quest_variable", args -> Long.toString(state.variable(argument(args))), true);
    story.bindExternalFunction(
        "quest_reputation", args -> Long.toString(state.reputation(argument(args))), true);
    story.bindExternalFunction(
        "quest_points",
        args -> {
          noArguments(args);
          return Long.toString(state.points());
        },
        true);
    story.bindExternalFunction(
        "quest_can_accept",
        args ->
            context
                .catalog()
                .quest(argument(args))
                .map(
                    quest ->
                        QuestEngine.availability(state, quest, context)
                            == QuestEngine.Availability.OFFERABLE)
                .orElseThrow(() -> new IllegalArgumentException("Unknown quest in Ink dialogue")),
        true);
  }

  private static String argument(Object[] args) {
    if (args.length != 1 || !(args[0] instanceof String value)) {
      throw new IllegalArgumentException("Ink quest function requires one string argument");
    }
    return value;
  }

  private static void noArguments(Object[] args) {
    if (args.length != 0) {
      throw new IllegalArgumentException("Ink quest_points takes no arguments");
    }
  }

  private Reference reference(String source) {
    var separator = source.indexOf('#', PREFIX.length());
    if (separator < 0 || separator == PREFIX.length() || separator == source.length() - 1) {
      throw new IllegalStateException("Ink reference must be ink:<script>#<knot>: " + source);
    }
    var script = source.substring(PREFIX.length(), separator);
    var knot = source.substring(separator + 1);
    if (!scripts.containsKey(script)) {
      throw new IllegalStateException("Missing Ink dialogue script: " + script);
    }
    return new Reference(script, knot);
  }

  private record Reference(String script, String knot) {}

  private static final class NoIncludes implements IFileHandler {
    private final String sourceFilename;

    private NoIncludes(String sourceFilename) {
      this.sourceFilename = sourceFilename;
    }

    @Override
    public String resolveInkFilename(String includeName) {
      if (sourceFilename.equals(includeName)) {
        return sourceFilename;
      }
      throw new IllegalArgumentException("Ink INCLUDE is not supported: " + includeName);
    }

    @Override
    public String loadInkFileContents(String fullFilename) {
      throw new IllegalArgumentException("Ink INCLUDE is not supported: " + fullFilename);
    }
  }
}
