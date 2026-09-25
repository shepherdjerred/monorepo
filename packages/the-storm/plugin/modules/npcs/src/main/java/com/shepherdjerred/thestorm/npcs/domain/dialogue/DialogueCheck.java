package com.shepherdjerred.thestorm.npcs.domain.dialogue;

import com.shepherdjerred.thestorm.npcs.app.dialogue.DialogueGraph;
import com.shepherdjerred.thestorm.npcs.app.dialogue.DialogueGraph.DialogueNode;
import com.shepherdjerred.thestorm.npcs.app.dialogue.DialogueGraph.OptionEffect;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;

/**
 * Validates a {@link DialogueGraph}. The limits keep every screen inside what both the Java dialog
 * and Geyser's Bedrock form show well: a plain-text body and a single column of short buttons.
 *
 * <p>Loops are allowed through a player's choice ({@code goto} options, such as "ask something
 * else"), but not through {@code next} links alone, which would be a conversation that goes round
 * forever with only a Continue button.
 */
public final class DialogueCheck {

  /** The longest title. */
  public static final int MAX_TITLE = 48;

  /** The longest node text. */
  public static final int MAX_TEXT = 600;

  /** The longest button label. */
  public static final int MAX_LABEL = 32;

  /** The most options on one node. */
  public static final int MAX_OPTIONS = 6;

  /** Node ids: lowercase words. */
  public static final Pattern NODE_ID = Pattern.compile("[a-z0-9][a-z0-9_-]*");

  /** Action ids: namespaced by the module that registers them, such as {@code quests.accept}. */
  public static final Pattern ACTION_ID = Pattern.compile("[a-z0-9_-]+(\\.[a-z0-9_-]+)+");

  private DialogueCheck() {}

  /** Every problem with {@code graph}; empty when it is valid. */
  public static List<String> problems(DialogueGraph graph) {
    var problems = new ArrayList<String>();
    if (graph.title().length() > MAX_TITLE) {
      problems.add("title is longer than " + MAX_TITLE + " characters");
    }
    if (!graph.nodes().containsKey(graph.start())) {
      problems.add("start node " + graph.start() + " does not exist");
    }
    for (var id : new TreeSet<>(graph.nodes().keySet())) {
      var node = graph.nodes().get(id);
      if (node != null) {
        nodeProblems(graph, id, node)
            .forEach(problem -> problems.add("node " + id + ": " + problem));
      }
    }
    if (problems.isEmpty()) {
      unreachable(graph)
          .forEach(id -> problems.add("node " + id + " is unreachable from " + graph.start()));
      nextLoops(graph).forEach(problems::add);
    }
    return problems;
  }

  private static List<String> nodeProblems(DialogueGraph graph, String id, DialogueNode node) {
    var problems = new ArrayList<String>();
    if (!NODE_ID.matcher(id).matches()) {
      problems.add("id must be lowercase letters, digits, - and _");
    }
    if (node.text().isBlank() || node.text().length() > MAX_TEXT) {
      problems.add("text must be 1.." + MAX_TEXT + " characters");
    }
    if (node.next().isPresent() == !node.options().isEmpty()) {
      problems.add("needs either next (a Continue button) or options, not both or neither");
    }
    node.next()
        .filter(target -> !graph.nodes().containsKey(target))
        .ifPresent(target -> problems.add("next node " + target + " does not exist"));
    if (node.options().size() > MAX_OPTIONS) {
      problems.add("has more than " + MAX_OPTIONS + " options");
    }
    for (var option : node.options()) {
      if (option.label().isBlank() || option.label().length() > MAX_LABEL) {
        problems.add(
            "option label \"" + option.label() + "\" must be 1.." + MAX_LABEL + " characters");
      }
      effectProblem(graph, option.effect()).ifPresent(problems::add);
    }
    return problems;
  }

  private static Optional<String> effectProblem(DialogueGraph graph, OptionEffect effect) {
    return switch (effect) {
      case OptionEffect.Goto(var target) when !graph.nodes().containsKey(target) ->
          Optional.of("goto target " + target + " does not exist");
      case OptionEffect.RunAction(var action) when !ACTION_ID.matcher(action).matches() ->
          Optional.of("action " + action + " must be namespaced, such as quests.accept");
      case OptionEffect.Goto _,
          OptionEffect.RunAction _,
          OptionEffect.Close _,
          OptionEffect.OpenTrainer _ ->
          Optional.empty();
    };
  }

  private static Set<String> unreachable(DialogueGraph graph) {
    var seen = new HashSet<String>();
    var queue = new ArrayDeque<String>();
    queue.add(graph.start());
    while (!queue.isEmpty()) {
      var id = queue.poll();
      var node = graph.nodes().get(id);
      if (node == null || !seen.add(id)) {
        continue;
      }
      node.next().ifPresent(queue::add);
      for (var option : node.options()) {
        if (option.effect() instanceof OptionEffect.Goto(var target)) {
          queue.add(target);
        }
      }
    }
    var unreachable = new TreeSet<>(graph.nodes().keySet());
    unreachable.removeAll(seen);
    return unreachable;
  }

  /** Loops made only of {@code next} links, each reported once from its smallest node id. */
  private static List<String> nextLoops(DialogueGraph graph) {
    var loops = new ArrayList<String>();
    for (var start : new TreeSet<>(graph.nodes().keySet())) {
      var chain = new LinkedHashSet<String>();
      @Nullable String current = start;
      while (current != null && chain.add(current)) {
        var node = graph.nodes().get(current);
        current = node == null ? null : node.next().orElse(null);
      }
      var closesOnStart = start.equals(current);
      if (closesOnStart && new TreeSet<>(chain).first().equals(start)) {
        loops.add(
            "nodes "
                + String.join(" -> ", chain)
                + " -> "
                + start
                + " loop through next links only; give one an option with goto instead");
      }
    }
    return loops;
  }
}
