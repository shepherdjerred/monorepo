package com.shepherdjerred.thestorm.npcs.domain.content;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.npcs.app.dialogue.DialogueGraph;
import com.shepherdjerred.thestorm.npcs.app.dialogue.DialogueGraph.DialogueNode;
import com.shepherdjerred.thestorm.npcs.app.dialogue.DialogueGraph.DialogueOption;
import com.shepherdjerred.thestorm.npcs.app.dialogue.DialogueGraph.OptionEffect;
import com.shepherdjerred.thestorm.npcs.domain.content.ContentCompiler.Located;
import com.shepherdjerred.thestorm.npcs.domain.content.ContentFile.DialogueEntry;
import com.shepherdjerred.thestorm.npcs.domain.content.ContentFile.NodeEntry;
import com.shepherdjerred.thestorm.npcs.domain.dialogue.DialogueCheck;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Optional;

/** Validates one dialogue entry. */
final class DialogueCompiler {

  private static final String GOTO = "goto:";
  private static final String ACTION = "action:";

  private final Problems problems;
  private final Located<DialogueEntry> located;
  private boolean failed;

  DialogueCompiler(Problems problems, Located<DialogueEntry> located) {
    this.problems = problems;
    this.located = located;
  }

  /**
   * Parses a button's {@code then}: {@code close}, {@code goto:<node>}, {@code trainer} or {@code
   * action:<id>}.
   */
  static Result<OptionEffect, String> effect(String then) {
    if ("close".equals(then)) {
      return Result.ok(new OptionEffect.Close());
    }
    if ("trainer".equals(then)) {
      return Result.ok(new OptionEffect.OpenTrainer());
    }
    if (then.startsWith(GOTO) && then.length() > GOTO.length()) {
      return Result.ok(new OptionEffect.Goto(then.substring(GOTO.length())));
    }
    if (then.startsWith(ACTION) && then.length() > ACTION.length()) {
      return Result.ok(new OptionEffect.RunAction(then.substring(ACTION.length())));
    }
    return Result.err(
        "then must be close, trainer, goto:<node> or action:<module.action>, not \"" + then + "\"");
  }

  Optional<DialogueGraph> compile() {
    var entry = located.entry();
    if (entry.title().isBlank()) {
      fail("title", "title must not be blank");
    }
    var nodes = new LinkedHashMap<String, DialogueNode>();
    entry.nodes().forEach((id, node) -> nodes.put(id, node(id, node)));
    if (failed) {
      return Optional.empty();
    }
    var graph = new DialogueGraph(located.id(), entry.title(), entry.start(), nodes);
    var graphProblems = DialogueCheck.problems(graph);
    if (!graphProblems.isEmpty()) {
      graphProblems.forEach(problem -> problems.add(located, "", problem));
      return Optional.empty();
    }
    return Optional.of(graph);
  }

  private DialogueNode node(String id, NodeEntry entry) {
    var next = Ids.NONE.equals(entry.next()) ? Optional.<String>empty() : Optional.of(entry.next());
    var options = new ArrayList<DialogueOption>();
    for (var index = 0; index < entry.options().size(); index++) {
      var option = entry.options().get(index);
      switch (effect(option.then())) {
        case Result.Ok<OptionEffect, String>(var effect) ->
            options.add(new DialogueOption(option.label(), effect));
        case Result.Err<OptionEffect, String>(var problem) ->
            fail("nodes." + id + ".options[" + index + "].then", problem);
      }
    }
    return new DialogueNode(entry.text(), next, options);
  }

  private void fail(String path, String message) {
    failed = true;
    problems.add(located, path, message);
  }
}
