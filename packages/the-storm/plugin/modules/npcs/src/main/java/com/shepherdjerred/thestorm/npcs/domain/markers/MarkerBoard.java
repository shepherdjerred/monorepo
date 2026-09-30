package com.shepherdjerred.thestorm.npcs.domain.markers;

import com.shepherdjerred.thestorm.npcs.app.QuestMarker;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Which marker each player should see above each NPC. Markers last until the player quits; the
 * quests module sets them again when they join. Main thread only.
 */
public final class MarkerBoard {

  private final Map<UUID, Map<String, QuestMarker>> byPlayer = new HashMap<>();

  /** A marker that changed for one player. */
  public record Change(UUID player, String npc, QuestMarker before, QuestMarker after) {

    /** Whether anything visible changed. */
    public boolean changed() {
      return before != after;
    }
  }

  /** Sets {@code player}'s marker above {@code npc}; {@link QuestMarker#NONE} clears it. */
  public Change set(UUID player, String npc, QuestMarker marker) {
    var markers = byPlayer.computeIfAbsent(player, ignored -> new HashMap<>());
    var before = markers.getOrDefault(npc, QuestMarker.NONE);
    if (marker == QuestMarker.NONE) {
      markers.remove(npc);
      if (markers.isEmpty()) {
        byPlayer.remove(player);
      }
    } else {
      markers.put(npc, marker);
    }
    return new Change(player, npc, before, marker);
  }

  /** {@code player}'s marker above {@code npc}. */
  public QuestMarker get(UUID player, String npc) {
    var markers = byPlayer.get(player);
    return markers == null ? QuestMarker.NONE : markers.getOrDefault(npc, QuestMarker.NONE);
  }

  /** Every marker {@code player} sees, by NPC. */
  public Map<String, QuestMarker> of(UUID player) {
    return Map.copyOf(byPlayer.getOrDefault(player, Map.of()));
  }

  /** Every player who sees a marker above {@code npc}, with their marker. */
  public Map<UUID, QuestMarker> above(String npc) {
    var result = new HashMap<UUID, QuestMarker>();
    byPlayer.forEach(
        (player, markers) -> {
          var marker = markers.get(npc);
          if (marker != null) {
            result.put(player, marker);
          }
        });
    return Map.copyOf(result);
  }

  /** Forgets {@code player}'s markers (they quit). */
  public void forget(UUID player) {
    byPlayer.remove(player);
  }
}
