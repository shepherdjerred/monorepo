package com.shepherdjerred.thestorm.npcs.domain.dialogue;

import com.shepherdjerred.thestorm.npcs.app.dialogue.DialogueGraph;
import com.shepherdjerred.thestorm.npcs.app.dialogue.DialogueGraph.OptionEffect;
import com.shepherdjerred.thestorm.npcs.domain.dialogue.Screen.Button;
import com.shepherdjerred.thestorm.npcs.domain.dialogue.Screen.Choice;
import java.util.List;

/** Turns dialogue nodes into screens. */
public final class DialogueScreens {

  private DialogueScreens() {}

  /**
   * The screen for {@code nodeId} of a valid {@code graph}. A node with {@code next} gets one
   * button labelled {@code continueLabel}.
   */
  public static Screen node(DialogueGraph graph, String nodeId, String continueLabel) {
    var node = graph.nodes().get(nodeId);
    if (node == null) {
      throw new IllegalArgumentException("dialogue " + graph.id() + " has no node " + nodeId);
    }
    var buttons =
        node.next()
            .map(next -> List.of(new Button(continueLabel, new Choice.ShowNode(graph, next))))
            .orElseGet(
                () ->
                    node.options().stream()
                        .map(option -> new Button(option.label(), choice(graph, option.effect())))
                        .toList());
    return new Screen(graph.title(), node.text(), buttons);
  }

  private static Choice choice(DialogueGraph graph, OptionEffect effect) {
    return switch (effect) {
      case OptionEffect.Close() -> new Choice.Close();
      case OptionEffect.Goto(var node) -> new Choice.ShowNode(graph, node);
      case OptionEffect.OpenTrainer() -> new Choice.OpenTrainer();
      case OptionEffect.RunAction(var action) -> new Choice.RunAction(action);
    };
  }
}
