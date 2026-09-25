package com.shepherdjerred.thestorm.npcs.domain.dialogue;

import com.shepherdjerred.thestorm.npcs.app.dialogue.DialogueGraph;
import com.shepherdjerred.thestorm.npcs.domain.trainer.Offer;
import java.util.List;

/**
 * One dialog as the player sees it: a title, a plain-text body and a column of buttons. This is the
 * Bedrock-safe subset of the Dialog API: no inputs, tooltips or item bodies.
 */
public record Screen(String title, String body, List<Button> buttons) {

  public Screen {
    buttons = List.copyOf(buttons);
    if (buttons.isEmpty()) {
      throw new IllegalArgumentException("a screen needs at least one button");
    }
  }

  /** A button and what choosing it means. */
  public record Button(String label, Choice choice) {}

  /** What a button asks for. The app layer carries it out. */
  public sealed interface Choice {

    /** Close the dialog. */
    record Close() implements Choice {}

    /** Show {@code node} of {@code graph}. */
    record ShowNode(DialogueGraph graph, String node) implements Choice {}

    /** Show the NPC's trainer screen. */
    record OpenTrainer() implements Choice {}

    /** Close the dialog and run a registered action. */
    record RunAction(String action) implements Choice {}

    /** Ask the player to confirm buying {@code offer}. */
    record Buy(Offer offer) implements Choice {}

    /** Buy {@code offer}; the player has confirmed. */
    record Confirm(Offer offer) implements Choice {}
  }
}
