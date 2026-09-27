package com.shepherdjerred.thestorm.npcs.adapter.paper;

import com.shepherdjerred.thestorm.npcs.app.MarkerService.MarkerDisplays;
import com.shepherdjerred.thestorm.npcs.app.QuestMarker;
import com.shepherdjerred.thestorm.npcs.domain.config.NpcsConfig;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Location;
import org.bukkit.entity.Display;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.entity.TextDisplay;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.Plugin;

/**
 * Quest markers as text displays: at most one per NPC and marker kind, hidden from everyone by
 * default and shown per player. They are not saved with the world; they are made when first needed
 * and follow their NPC. On Bedrock a text display shows as a plain name tag. Main thread.
 */
final class MarkerEntities implements MarkerDisplays {

  /**
   * Display ticks spent gliding to a new position, so markers keep up with walking NPCs smoothly.
   */
  private static final int GLIDE_TICKS = 2;

  private final Plugin plugin;
  private final NpcKeys keys;
  private final NpcsConfig.Markers settings;
  private final Function<String, Optional<Location>> npcLocation;
  private final Map<String, Map<QuestMarker, TextDisplay>> displays = new HashMap<>();

  /**
   * @param npcLocation where an NPC's entity is now, if it is loaded
   */
  MarkerEntities(
      Plugin plugin,
      NpcKeys keys,
      NpcsConfig.Markers settings,
      Function<String, Optional<Location>> npcLocation) {
    this.plugin = plugin;
    this.keys = keys;
    this.settings = settings;
    this.npcLocation = npcLocation;
  }

  @Override
  public void update(Player player, String npc, QuestMarker marker) {
    if (marker != QuestMarker.NONE) {
      ensure(npc, marker);
    }
    displays
        .getOrDefault(npc, Map.of())
        .forEach(
            (kind, display) -> {
              if (kind == marker) {
                player.showEntity(plugin, display);
              } else {
                player.hideEntity(plugin, display);
              }
            });
  }

  /** Moves {@code npc}'s markers above {@code feet}. */
  void follow(String npc, Location feet) {
    var markers = displays.get(npc);
    if (markers != null) {
      var above = feet.clone().add(0, settings.height(), 0);
      markers.values().forEach(display -> display.teleport(above));
    }
  }

  /** Removes {@code npc}'s displays; they are made again when next needed. */
  void remove(String npc) {
    var markers = displays.remove(npc);
    if (markers != null) {
      markers.values().forEach(Entity::remove);
    }
  }

  void removeAll() {
    displays.values().forEach(markers -> markers.values().forEach(Entity::remove));
    displays.clear();
  }

  boolean isMarker(Entity entity) {
    return entity.getPersistentDataContainer().has(keys.marker(), PersistentDataType.BYTE);
  }

  private void ensure(String npc, QuestMarker marker) {
    var markers = displays.computeIfAbsent(npc, ignored -> new EnumMap<>(QuestMarker.class));
    var existing = markers.get(marker);
    if (existing != null && existing.isValid()) {
      return;
    }
    npcLocation
        .apply(npc)
        .ifPresent(
            feet ->
                markers.put(
                    marker,
                    feet.getWorld()
                        .spawn(
                            feet.clone().add(0, settings.height(), 0),
                            TextDisplay.class,
                            display -> dress(display, marker))));
  }

  private void dress(TextDisplay display, QuestMarker marker) {
    var symbol =
        switch (marker) {
          case AVAILABLE -> settings.available();
          case TURN_IN -> settings.turnIn();
          case NONE -> throw new IllegalArgumentException("no display for NONE");
        };
    display.text(Component.text(symbol, NamedTextColor.GOLD, TextDecoration.BOLD));
    display.setBillboard(Display.Billboard.CENTER);
    display.setVisibleByDefault(false);
    display.setPersistent(false);
    display.setTeleportDuration(GLIDE_TICKS);
    display.getPersistentDataContainer().set(keys.marker(), PersistentDataType.BYTE, (byte) 1);
  }
}
