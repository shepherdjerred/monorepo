package com.shepherdjerred.thestorm.npcs.app.dialogue;

import com.shepherdjerred.thestorm.npcs.domain.dialogue.DialogueCheck;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * A conversation: nodes of text, each offering buttons that lead to other nodes or do something.
 * Shown through the Dialog API as one plain-text body and a column of buttons, which Bedrock
 * players also see (Geyser turns it into a simple form).
 *
 * <p>Construction checks only the shape. Call {@link #problems()} (content loading does) for the
 * full check: every target exists, every node is reachable from {@code start}, no dead ends, no
 * loop made only of {@code next} links, and text within the length limits.
 *
 * @param id a stable id, for logs
 * @param title the dialog title, usually the NPC's name
 * @param start the node shown first
 * @param nodes every node by id
 */
public record DialogueGraph(
    String id, String title, String start, Map<String, DialogueNode> nodes) {

  public DialogueGraph {
    nodes = Map.copyOf(nodes);
    if (id.isBlank() || title.isBlank()) {
      throw new IllegalArgumentException("a dialogue needs an id and a title");
    }
  }

  /** One screen of a conversation. */
  public record DialogueNode(String text, Optional<String> next, List<DialogueOption> options) {

    public DialogueNode {
      options = List.copyOf(options);
    }
  }

  /** A button: its label and what it does. */
  public record DialogueOption(String label, OptionEffect effect) {}

  /** What a button does. */
  public sealed interface OptionEffect {

    /** Ends the conversation. */
    record Close() implements OptionEffect {}

    /** Shows another node of the same dialogue. */
    record Goto(String node) implements OptionEffect {}

    /** Opens the NPC's trainer screen; only for NPCs that train a track. */
    record OpenTrainer() implements OptionEffect {}

    /** Closes the dialog and runs an action another module registered with {@code NpcActions}. */
    record RunAction(String action) implements OptionEffect {}
  }

  /** Every reason this graph cannot be shown; empty when it is valid. */
  public List<String> problems() {
    return DialogueCheck.problems(this);
  }
}
