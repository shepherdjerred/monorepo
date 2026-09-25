package com.shepherdjerred.thestorm.npcs.app;

import com.shepherdjerred.thestorm.npcs.app.dialogue.DialogueGraph;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.bukkit.entity.Player;

/** The {@link NpcDialogs} registry. */
public final class DialogueRegistry implements NpcDialogs {

  private final List<DialogueProvider> providers = new ArrayList<>();

  @Override
  public void register(DialogueProvider provider) {
    providers.add(provider);
  }

  /**
   * The first dialogue a provider offers for {@code npc}.
   *
   * @throws IllegalStateException if a provider offers an invalid graph
   */
  public Optional<DialogueGraph> provided(Player player, NpcRef npc) {
    for (var provider : providers) {
      var offered = provider.dialogueFor(player, npc);
      if (offered.isPresent()) {
        var problems = offered.get().problems();
        if (!problems.isEmpty()) {
          throw new IllegalStateException(
              "dialogue "
                  + offered.get().id()
                  + " for NPC "
                  + npc.id()
                  + " is invalid: "
                  + problems);
        }
        return offered;
      }
    }
    return Optional.empty();
  }
}
