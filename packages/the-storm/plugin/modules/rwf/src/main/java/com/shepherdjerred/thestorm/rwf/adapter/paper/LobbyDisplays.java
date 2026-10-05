package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.kit.KitSpec;
import com.shepherdjerred.thestorm.rwf.domain.lobby.LobbyStatus;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.function.Consumer;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Location;
import org.bukkit.entity.Display;
import org.bukkit.entity.ItemDisplay;
import org.bukkit.entity.TextDisplay;
import org.bukkit.event.entity.CreatureSpawnEvent.SpawnReason;
import org.jspecify.annotations.Nullable;

/**
 * The lobby's dressing, as display entities because the room's schematic carries no block entities:
 * the rules in front of the north wall, a live match board in front of the south wall, and in each
 * kit alcove the kit's menu icon over its pedestal with its name and summary above. Every entity is
 * tagged, not saved with the world, and swept before the room is dressed again, so they are never
 * duplicated. Main thread only.
 */
final class LobbyDisplays {

  static final String RULES = "rules";
  static final String BOARD = "board";
  static final String ITEM = "alcove-item:";
  static final String LABEL = "alcove-label:";

  /** Wide enough that no rule or kit line wraps. */
  private static final int LINE_WIDTH = 400;

  /** How far above the item its label floats. */
  private static final double LABEL_HEIGHT = 1.6;

  static final List<String> RULES_LINES =
      List.of(
          "One life each. The last team standing wins.",
          "Hold your Bomb Fuse (slot 1) and right-click an enemy",
          "TNT bomb to arm it, or your own armed bomb to defuse it.",
          "An armed bomb explodes after 60 seconds and kills its team.",
          "The nuke in the middle kills everyone but the team that armed it.",
          "After about ten minutes the poison ends the round.",
          "Right-click the nether star to choose a kit (or /rwf kit <name>).",
          "Right-click the red dye (or /rwf leave) to go back to survival.");

  private final PaperContext context;
  private final Keys keys;
  private final LobbyRoom room;
  private final List<KitSpec> kits;
  private final KitFactory items;
  private final Consumer<Display> style;
  private @Nullable TextDisplay board;
  private List<String> shown = List.of();

  /**
   * What the displays are made of.
   *
   * @param context the shared server services
   * @param keys entity tags
   * @param room the lobby room
   * @param kits the kits, one per alcove, with their items
   * @param style styles each display once spawned (its billboard)
   */
  record Parts(
      PaperContext context, Keys keys, LobbyRoom room, KitFactory kits, Consumer<Display> style) {}

  LobbyDisplays(Parts parts) {
    this.context = parts.context();
    this.keys = parts.keys();
    this.room = parts.room();
    this.items = parts.kits();
    this.style = parts.style();
    this.kits = room.layout().kits().stream().map(items::require).toList();
  }

  /** Sweeps every lobby display left in the world, then dresses the room afresh. */
  void open() {
    clear();
    var layout = room.layout();
    var _ = spawnText(Places.location(context.world(), layout.rules()), RULES, rules());
    board =
        spawnText(
            Places.location(context.world(), layout.board()),
            BOARD,
            Component.text("Next match", NamedTextColor.GOLD, TextDecoration.BOLD));
    shown = List.of();
    for (var kit : kits) {
      var alcove = layout.alcove(kit.id()).orElseThrow();
      var at = Places.location(context.world(), alcove.display());
      at.setYaw(alcove.stand().yaw() + 180);
      spawnItem(at, kit);
      var _ = spawnText(at.clone().add(0, LABEL_HEIGHT, 0), LABEL + kit.id(), label(kit));
    }
  }

  /** Redraws the match board for {@code status}, only when its text changed. */
  void update(LobbyStatus status) {
    var lines = boardLines(status);
    var display = board;
    if (display == null || lines.equals(shown)) {
      return;
    }
    var text = Component.text(lines.getFirst(), NamedTextColor.GOLD, TextDecoration.BOLD);
    for (var line : lines.subList(1, lines.size())) {
      text = text.appendNewline().append(Component.text(line, NamedTextColor.WHITE));
    }
    display.text(text);
    shown = lines;
  }

  /** Removes every lobby display in the world, tracked or left over. */
  void clear() {
    for (var entity : context.world().getEntities()) {
      if (keys.lobbyPart(entity).isPresent()) {
        entity.remove();
      }
    }
    board = null;
    shown = List.of();
  }

  /** The lobby displays standing in the world now, by part, for tests and diagnostics. */
  Map<String, Integer> standing() {
    var counts = new TreeMap<String, Integer>();
    for (var entity : context.world().getEntities()) {
      keys.lobbyPart(entity).ifPresent(part -> counts.merge(part, 1, Integer::sum));
    }
    return counts;
  }

  private TextDisplay spawnText(Location at, String part, Component text) {
    return context
        .world()
        .spawn(
            at,
            TextDisplay.class,
            display -> {
              display.text(text);
              display.setLineWidth(LINE_WIDTH);
              display.setAlignment(TextDisplay.TextAlignment.CENTER);
              decorate(display, part);
            },
            SpawnReason.CUSTOM);
  }

  private void spawnItem(Location at, KitSpec kit) {
    var _ =
        context
            .world()
            .spawn(
                at,
                ItemDisplay.class,
                display -> {
                  display.setItemStack(items.icon(kit, false));
                  decorate(display, ITEM + kit.id());
                },
                SpawnReason.CUSTOM);
  }

  private void decorate(Display display, String part) {
    style.accept(display);
    display.setPersistent(false);
    keys.tagLobby(display, part);
  }

  private static Component rules() {
    var text = Component.text("Search and Destroy", NamedTextColor.RED, TextDecoration.BOLD);
    for (var line : RULES_LINES) {
      text = text.appendNewline().append(Component.text(line, NamedTextColor.WHITE));
    }
    return text;
  }

  private static Component label(KitSpec kit) {
    var text = Component.text(kit.name(), NamedTextColor.GOLD, TextDecoration.BOLD);
    for (var line : kit.menu().summary()) {
      text = text.appendNewline().append(Component.text(line, NamedTextColor.GRAY));
    }
    return text.appendNewline()
        .append(Component.text("/rwf kit " + kit.id(), NamedTextColor.YELLOW));
  }

  /** The board's lines: a title, then the map, who is in, and what the match is doing. */
  static List<String> boardLines(LobbyStatus status) {
    var stage =
        switch (status.stage()) {
          case EMPTY -> "Waiting for players";
          case WAITING ->
              "Waiting for "
                  + status.needed()
                  + (status.needed() == 1 ? " more player" : " more players");
          case COUNTDOWN -> "Starting in " + status.secondsLeft() + "s";
          case LIVE -> "Match in progress";
          case ENDED -> "Match over";
          case RESETTING -> "Resetting the map";
        };
    return List.of(
        "Next match",
        "Map: " + status.map().orElse("choosing"),
        "Players: " + status.humans() + "   Bots: " + status.bots(),
        stage);
  }
}
