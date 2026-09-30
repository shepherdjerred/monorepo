package com.shepherdjerred.thestorm.quests.domain.view;

import java.util.List;
import java.util.Map;

/**
 * A quest conversation with an NPC: nodes of text with a column of buttons. The app layer turns it
 * into the NPCs' dialogue graph, where quest choices become registered actions.
 *
 * @param title the dialog title (the NPC's name)
 * @param start the first node
 * @param nodes every node by id
 */
public record QuestDialogue(String title, String start, Map<String, Node> nodes) {

  public QuestDialogue {
    nodes = Map.copyOf(nodes);
  }

  /** The node with {@code id}; it must exist. */
  public Node node(String id) {
    var node = nodes.get(id);
    if (node == null) {
      throw new IllegalArgumentException("dialogue has no node " + id);
    }
    return node;
  }

  /** One screen. */
  public record Node(String text, List<Option> options) {
    public Node {
      options = List.copyOf(options);
    }
  }

  /** A button. */
  public record Option(String label, Choice choice) {}

  /** What a button does. */
  public sealed interface Choice {

    /** Shows another node. */
    record Goto(String node) implements Choice {}

    /** Closes the dialog. */
    record Close() implements Choice {}

    /** Accepts {@code quest}. */
    record Accept(String quest) implements Choice {}

    /** Hands in at this NPC for {@code quest}. */
    record HandIn(String quest) implements Choice {}

    /** Picks option {@code option} of {@code quest}'s choice. */
    record Choose(String quest, int option) implements Choice {}
  }
}
