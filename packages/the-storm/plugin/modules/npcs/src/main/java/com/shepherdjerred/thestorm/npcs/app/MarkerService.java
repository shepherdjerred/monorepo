package com.shepherdjerred.thestorm.npcs.app;

import com.shepherdjerred.thestorm.npcs.domain.markers.MarkerBoard;
import java.util.UUID;
import java.util.function.Function;
import org.bukkit.entity.Player;
import org.jspecify.annotations.Nullable;

/** {@link NpcMarkers}: remembers each player's markers and keeps their displays in step. */
public final class MarkerService implements NpcMarkers {

  /** Shows markers; the Paper adapter uses one hidden text display per NPC and marker. */
  public interface MarkerDisplays {

    /** Makes {@code player} see {@code marker} (and no other) above {@code npc}. */
    void update(Player player, String npc, QuestMarker marker);
  }

  private final NpcCatalog catalog;
  private final MarkerBoard board = new MarkerBoard();
  private final MarkerDisplays displays;

  public MarkerService(NpcCatalog catalog, MarkerDisplays displays) {
    this.catalog = catalog;
    this.displays = displays;
  }

  @Override
  public void set(Player player, String npc, QuestMarker marker) {
    if (catalog.content().npc(npc).isEmpty()) {
      throw new IllegalArgumentException("no NPC has id " + npc);
    }
    var change = board.set(player.getUniqueId(), npc, marker);
    if (change.changed()) {
      displays.update(player, npc, marker);
    }
  }

  /** The marker {@code player} sees above {@code npc}. */
  public QuestMarker get(Player player, String npc) {
    return board.get(player.getUniqueId(), npc);
  }

  /**
   * Re-shows {@code npc}'s markers to every online player who has one (its displays were rebuilt).
   */
  public void showNpc(String npc, Function<UUID, @Nullable Player> online) {
    board
        .above(npc)
        .forEach(
            (id, marker) -> {
              var player = online.apply(id);
              if (player != null) {
                displays.update(player, npc, marker);
              }
            });
  }

  /** Forgets {@code player}'s markers (they quit). */
  public void forget(Player player) {
    board.forget(player.getUniqueId());
  }
}
