package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.app.store.StatsStore;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Spawn;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitSpec;
import com.shepherdjerred.thestorm.rwf.domain.lobby.LobbyLayout;
import com.shepherdjerred.thestorm.rwf.domain.lobby.LobbyStatus;
import com.shepherdjerred.thestorm.rwf.domain.match.Ballot;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import java.util.function.Consumer;
import java.util.function.Supplier;
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
 * The lobby's dressing, as display entities because the lobby's schematic carries no block
 * entities: the rules on the briefing room's screen, the live match board over the vote terrace, a
 * podium display per map on the ballot with its name, author and votes, the leaderboard wall, the
 * free-rotation wall's header, and in each kit alcove the kit's menu icon over its pedestal with
 * its name and summary above. Every entity is tagged, not saved with the world, and swept before
 * the lobby is dressed again, so they are never duplicated. Main thread only.
 */
final class LobbyDisplays {

  static final String RULES = "rules";
  static final String BOARD = "board";
  static final String ITEM = "alcove-item:";
  static final String LABEL = "alcove-label:";
  static final String PODIUM = "podium:";
  static final String LEADERBOARD = "leaderboard:";
  static final String ROTATION = "rotation";

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
          "Vote for the map at the podiums (or /rwf vote <map>).",
          "Right-click the red dye (or /rwf leave) to go back to survival.");

  private final PaperContext context;
  private final Keys keys;
  private final LobbyRoom room;
  private final List<KitSpec> kits;
  private final KitFactory items;
  private final Consumer<Display> style;
  private final Supplier<Map<StatsStore.Stat, List<StatsStore.Totals>>> leaders;
  private final Supplier<Boolean> showStats;
  private final Map<String, TextDisplay> texts = new HashMap<>();
  private final Map<String, List<String>> shown = new HashMap<>();

  /**
   * What the displays are made of.
   *
   * @param context the shared server services
   * @param keys entity tags
   * @param room the lobby
   * @param kits the kits, one per alcove, with their items
   * @param style styles each display once spawned (its billboard)
   * @param leaders the leaderboards as last read
   * @param showStats whether the statistics feature is on
   */
  record Parts(
      PaperContext context,
      Keys keys,
      LobbyRoom room,
      KitFactory kits,
      Consumer<Display> style,
      Supplier<Map<StatsStore.Stat, List<StatsStore.Totals>>> leaders,
      Supplier<Boolean> showStats) {}

  LobbyDisplays(Parts parts) {
    this.context = parts.context();
    this.keys = parts.keys();
    this.room = parts.room();
    this.items = parts.kits();
    this.style = parts.style();
    this.leaders = parts.leaders();
    this.showStats = parts.showStats();
    this.kits = room.layout().kits().stream().map(items::require).toList();
  }

  private Location at(Spawn spawn) {
    return Places.location(context.lobbyWorld(), spawn);
  }

  private Location at(Vec3 point) {
    return Places.location(context.lobbyWorld(), point);
  }

  /** Sweeps every lobby display left in the world, then dresses the lobby afresh. */
  void open() {
    clear();
    var layout = room.layout();
    var _ = spawnText(at(layout.rules()), RULES, rules());
    texts.put(
        BOARD,
        spawnText(
            at(layout.board()),
            BOARD,
            Component.text("Next match", NamedTextColor.GOLD, TextDecoration.BOLD)));
    for (var i = 0; i < layout.podiums().size(); i++) {
      var part = PODIUM + (i + 1);
      texts.put(
          part,
          spawnText(
              at(layout.podiums().get(i).display()),
              part,
              Component.text("Map vote", NamedTextColor.GOLD, TextDecoration.BOLD)));
    }
    for (var leaderboard : layout.leaderboards()) {
      var part = LEADERBOARD + leaderboard.stat().name().toLowerCase(Locale.ROOT);
      texts.put(
          part,
          spawnText(at(leaderboard.display()), part, Component.text(title(leaderboard.stat()))));
    }
    var _ = spawnText(at(layout.rotation().header()), ROTATION, rotation());
    for (var kit : kits) {
      var alcove = layout.alcove(kit.id()).orElseThrow();
      var where = at(alcove.display());
      where.setYaw(alcove.stand().yaw() + 180);
      spawnItem(where, kit);
      var _ = spawnText(where.clone().add(0, LABEL_HEIGHT, 0), LABEL + kit.id(), label(kit));
    }
  }

  /** Redraws the match board, the podiums and the leaderboards, only where their text changed. */
  void update(LobbyStatus status, Optional<Ballot> ballot) {
    var board = new ArrayList<>(boardLines(status));
    ballot.filter(Ballot::opened).ifPresent(open -> board.addAll(ballotLines(open)));
    draw(BOARD, board);
    var podiums = room.layout().podiums();
    for (var i = 0; i < podiums.size(); i++) {
      draw(PODIUM + (i + 1), podiumLines(ballot, i));
    }
    var stats = showStats.get();
    for (var leaderboard : room.layout().leaderboards()) {
      var part = LEADERBOARD + leaderboard.stat().name().toLowerCase(Locale.ROOT);
      draw(
          part,
          leaderboardLines(
              leaderboard.stat(),
              stats ? leaders.get().getOrDefault(stat(leaderboard.stat()), List.of()) : List.of(),
              stats));
    }
  }

  private void draw(String part, List<String> lines) {
    var display = texts.get(part);
    if (display == null || lines.equals(shown.get(part))) {
      return;
    }
    var text = Component.text(lines.getFirst(), NamedTextColor.GOLD, TextDecoration.BOLD);
    for (var line : lines.subList(1, lines.size())) {
      text = text.appendNewline().append(Component.text(line, NamedTextColor.WHITE));
    }
    display.text(text);
    shown.put(part, List.copyOf(lines));
  }

  /** Removes every lobby display in the world, tracked or left over. */
  void clear() {
    for (var entity : context.lobbyWorld().getEntities()) {
      if (keys.lobbyPart(entity).isPresent()) {
        entity.remove();
      }
    }
    texts.clear();
    shown.clear();
  }

  /** The lobby displays standing in the world now, by part, for tests and diagnostics. */
  Map<String, Integer> standing() {
    var counts = new TreeMap<String, Integer>();
    for (var entity : context.lobbyWorld().getEntities()) {
      keys.lobbyPart(entity).ifPresent(part -> counts.merge(part, 1, Integer::sum));
    }
    return counts;
  }

  private TextDisplay spawnText(Location where, String part, Component text) {
    return context
        .lobbyWorld()
        .spawn(
            where,
            TextDisplay.class,
            display -> {
              display.text(text);
              display.setLineWidth(LINE_WIDTH);
              display.setAlignment(TextDisplay.TextAlignment.CENTER);
              decorate(display, part);
            },
            SpawnReason.CUSTOM);
  }

  private void spawnItem(Location where, KitSpec kit) {
    var _ =
        context
            .lobbyWorld()
            .spawn(
                where,
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

  /** The free-rotation wall's header; the weekly rotation arrives with the kit shop. */
  private static Component rotation() {
    return Component.text("Free this week", NamedTextColor.GREEN, TextDecoration.BOLD)
        .appendNewline()
        .append(Component.text("The kit shop opens soon", NamedTextColor.GRAY));
  }

  private static Component label(KitSpec kit) {
    var text = Component.text(kit.name(), NamedTextColor.GOLD, TextDecoration.BOLD);
    for (var line : kit.menu().summary()) {
      text = text.appendNewline().append(Component.text(line, NamedTextColor.GRAY));
    }
    return text.appendNewline()
        .append(Component.text("/rwf kit " + kit.id(), NamedTextColor.YELLOW));
  }

  private static String title(LobbyLayout.Leaderboard.Stat stat) {
    return switch (stat) {
      case KILLS -> "Top kills";
      case WINS -> "Most wins";
      case WIN_STREAK -> "Best win streak";
    };
  }

  private static StatsStore.Stat stat(LobbyLayout.Leaderboard.Stat stat) {
    return switch (stat) {
      case KILLS -> StatsStore.Stat.KILLS;
      case WINS -> StatsStore.Stat.WINS;
      case WIN_STREAK -> StatsStore.Stat.BEST_WIN_STREAK;
    };
  }

  /** A leaderboard's lines: its title, then each leader with their figure. */
  static List<String> leaderboardLines(
      LobbyLayout.Leaderboard.Stat stat, List<StatsStore.Totals> rows, boolean open) {
    var lines = new ArrayList<String>();
    lines.add(title(stat));
    if (!open) {
      lines.add("Coming soon");
      return lines;
    }
    if (rows.isEmpty()) {
      lines.add("Nobody yet");
    }
    for (var i = 0; i < rows.size(); i++) {
      lines.add((i + 1) + ". " + rows.get(i).name() + "  " + rows.get(i).value(stat(stat)));
    }
    return lines;
  }

  /** What podium {@code index} shows: its map, author and votes, or that no vote is open. */
  static List<String> podiumLines(Optional<Ballot> ballot, int index) {
    var open = ballot.filter(Ballot::opened);
    if (open.isEmpty() || index >= open.orElseThrow().candidates().size()) {
      return List.of("Map vote", "No map here this round");
    }
    var vote = open.orElseThrow();
    var candidate = vote.candidates().get(index);
    var votes = vote.count(candidate.mapId());
    var chosen = vote.chosen().filter(candidate.mapId()::equals).isPresent();
    var lines = new ArrayList<String>();
    lines.add(candidate.name());
    lines.add("by " + candidate.author());
    lines.add(votes + (votes == 1 ? " vote" : " votes"));
    if (chosen) {
      lines.add("Chosen!");
    } else if (!vote.closed()) {
      lines.add("Right-click the lodestone to vote");
    }
    return lines;
  }

  /** The vote, one line per map with its votes, the winner marked once it closed. */
  static List<String> ballotLines(Ballot ballot) {
    var lines = new ArrayList<String>();
    for (var candidate : ballot.candidates()) {
      var won = ballot.chosen().filter(candidate.mapId()::equals).isPresent();
      var votes = ballot.count(candidate.mapId());
      lines.add(
          (won ? "> " : "") + candidate.name() + ": " + votes + (votes == 1 ? " vote" : " votes"));
    }
    return lines;
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
          case PREPARING -> "Loading the map";
          case PREVIEW -> "Previewing the map";
          case FREEZE -> "About to start";
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

  /** For tests: the displays' current text by part. */
  @Nullable List<String> shownFor(String part) {
    return shown.get(part);
  }
}
