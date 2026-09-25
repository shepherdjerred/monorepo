package com.shepherdjerred.thestorm.npcs.app;

import com.shepherdjerred.thestorm.npcs.app.dialogue.DialogueGraph;
import java.util.Optional;
import org.bukkit.entity.Player;

/**
 * Lets other modules supply what an NPC says. When a player talks to an NPC, each registered
 * provider is asked in registration order; the first dialogue offered is shown. If none offers one,
 * the NPC's own content dialogue is shown, and failing that its trainer screen.
 *
 * <p>The quests module registers here to put quest conversations in NPCs' mouths. A graph must be
 * valid ({@link DialogueGraph#problems()} empty); an invalid one is refused loudly.
 */
public interface NpcDialogs {

  /** Adds {@code provider}. Call during module enable. */
  void register(DialogueProvider provider);

  /** Supplies dialogue for NPCs. Main thread; keep it fast (it runs on every NPC click). */
  @FunctionalInterface
  interface DialogueProvider {

    /** What {@code npc} should say to {@code player}, or empty to let the next source answer. */
    Optional<DialogueGraph> dialogueFor(Player player, NpcRef npc);
  }
}
