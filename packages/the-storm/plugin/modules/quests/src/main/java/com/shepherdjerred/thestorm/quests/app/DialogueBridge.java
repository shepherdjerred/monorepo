package com.shepherdjerred.thestorm.quests.app;

import com.shepherdjerred.thestorm.npcs.app.dialogue.DialogueGraph;
import com.shepherdjerred.thestorm.npcs.app.dialogue.DialogueGraph.DialogueNode;
import com.shepherdjerred.thestorm.npcs.app.dialogue.DialogueGraph.DialogueOption;
import com.shepherdjerred.thestorm.npcs.app.dialogue.DialogueGraph.OptionEffect;
import com.shepherdjerred.thestorm.quests.domain.view.QuestDialogue;
import com.shepherdjerred.thestorm.quests.domain.view.QuestDialogue.Choice;
import java.util.HashMap;
import java.util.Optional;

/**
 * Quest dialogue as NPC dialogue: quest buttons become NPC actions the quests module registers, one
 * per quest ({@code quests.accept.<quest>}, {@code quests.turnin.<quest>}, {@code
 * quests.choose.<quest>.<option>}), because an NPC action receives only the player and the NPC.
 */
public final class DialogueBridge {

  /** Accepts the quest named after the prefix. */
  public static final String ACCEPT = "quests.accept";

  /** Hands in for the quest named after the prefix. */
  public static final String TURN_IN = "quests.turnin";

  /** Picks an option of the quest named after the prefix. */
  public static final String CHOOSE = "quests.choose";

  private DialogueBridge() {}

  /** The NPC action id for accepting {@code quest}. */
  public static String accept(String quest) {
    return ACCEPT + "." + quest;
  }

  /** The NPC action id for handing in {@code quest}. */
  public static String turnIn(String quest) {
    return TURN_IN + "." + quest;
  }

  /** The NPC action id for picking {@code option} of {@code quest}. */
  public static String choose(String quest, int option) {
    return CHOOSE + "." + quest + "." + option;
  }

  /** {@code dialogue} as a graph NPCs can show, with {@code npc}'s id in its own id. */
  public static DialogueGraph graph(String npc, QuestDialogue dialogue) {
    var nodes = new HashMap<String, DialogueNode>();
    dialogue
        .nodes()
        .forEach(
            (id, node) ->
                nodes.put(
                    id,
                    new DialogueNode(
                        node.text(),
                        Optional.empty(),
                        node.options().stream()
                            .map(
                                option ->
                                    new DialogueOption(option.label(), effect(option.choice())))
                            .toList())));
    return new DialogueGraph("quests-" + npc, dialogue.title(), dialogue.start(), nodes);
  }

  private static OptionEffect effect(Choice choice) {
    return switch (choice) {
      case Choice.Goto(var node) -> new OptionEffect.Goto(node);
      case Choice.Close() -> new OptionEffect.Close();
      case Choice.Accept(var quest) -> new OptionEffect.RunAction(accept(quest));
      case Choice.HandIn(var quest) -> new OptionEffect.RunAction(turnIn(quest));
      case Choice.Choose(var quest, var option) ->
          new OptionEffect.RunAction(choose(quest, option));
    };
  }
}
