package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.lobby.LobbyStatus;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Optional;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.Style;
import net.kyori.adventure.text.format.TextDecoration;
import net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer;
import org.bukkit.Server;
import org.bukkit.entity.Player;
import org.bukkit.scoreboard.Criteria;
import org.bukkit.scoreboard.DisplaySlot;
import org.bukkit.scoreboard.Objective;
import org.bukkit.scoreboard.Scoreboard;
import org.bukkit.scoreboard.Team;

/**
 * One scoreboard for the match: a team per {@link TeamColor} (name tags in the team's colour, no
 * friendly fire) with a {@code <team>_bot} sub-team whose members carry a dim {@code ✦} suffix, and
 * Red Warfare's sidebar: its lobby board until the match goes live, then its game board of the
 * teams still alive and their bombs. Members see it while inside and get the server's main board
 * back when they leave.
 */
final class Scoreboards {

  static final String OBJECTIVE = "rwf";
  static final String BOT_SUFFIX = " ✦";

  private final Server server;
  private final Scoreboard board;
  private final Objective sidebar;
  private final Objective kills;
  private List<String> shown = List.of();
  private Component shownTitle = Component.empty();

  Scoreboards(Server server) {
    this.server = server;
    this.board = server.getScoreboardManager().getNewScoreboard();
    for (var color : TeamColor.values()) {
      var team = board.registerNewTeam(teamName(color, false));
      team.color(color(color));
      team.setAllowFriendlyFire(false);
      team.setOption(Team.Option.NAME_TAG_VISIBILITY, Team.OptionStatus.ALWAYS);
      var bots = board.registerNewTeam(teamName(color, true));
      bots.color(color(color));
      bots.setAllowFriendlyFire(false);
      bots.setOption(Team.Option.NAME_TAG_VISIBILITY, Team.OptionStatus.ALWAYS);
      bots.suffix(Component.text(BOT_SUFFIX, NamedTextColor.DARK_GRAY));
    }
    this.sidebar = board.registerNewObjective(OBJECTIVE, Criteria.DUMMY, LOBBY_TITLE);
    sidebar.setDisplaySlot(DisplaySlot.SIDEBAR);
    this.kills = board.registerNewObjective(KILLS, Criteria.DUMMY, Component.text("Kills"));
  }

  /** The tab list's score: kills this match, as Red Warfare showed them. */
  static final String KILLS = "rwf_kills";

  /** Shows (or hides) kills as the tab list score. */
  void showKills(boolean show) {
    if (show) {
      kills.setDisplaySlot(DisplaySlot.PLAYER_LIST);
    } else if (board.getObjective(DisplaySlot.PLAYER_LIST) != null) {
      board.clearSlot(DisplaySlot.PLAYER_LIST);
    }
  }

  /** {@code name} has {@code count} kills on the tab list. */
  void kills(String name, int count) {
    kills.getScore(name).setScore(count);
  }

  static String teamName(TeamColor color, boolean bot) {
    return "rwf_" + color.name().toLowerCase(Locale.ROOT) + (bot ? "_bot" : "");
  }

  static NamedTextColor color(TeamColor color) {
    return switch (color) {
      case RED -> NamedTextColor.RED;
      case BLUE -> NamedTextColor.BLUE;
      case GREEN -> NamedTextColor.GREEN;
      case PURPLE -> NamedTextColor.DARK_PURPLE;
      case YELLOW -> NamedTextColor.YELLOW;
    };
  }

  Scoreboard board() {
    return board;
  }

  /** The player sees the match board. */
  void show(Player player) {
    player.setScoreboard(board);
  }

  /** The player is out: back to the server's board, off every team. */
  void hide(Player player) {
    unassign(player);
    player.setScoreboard(server.getScoreboardManager().getMainScoreboard());
  }

  void assign(Player player, TeamColor color, boolean bot) {
    unassign(player);
    Objects.requireNonNull(board.getTeam(teamName(color, bot)), "teams are registered at enable")
        .addEntry(player.getName());
  }

  void unassign(Player player) {
    var team = board.getEntryTeam(player.getName());
    if (team != null) {
      team.removeEntry(player.getName());
    }
  }

  /** The team entry {@code player} is on, for tests and diagnostics. */
  String teamOf(Player player) {
    var team = board.getEntryTeam(player.getName());
    return team == null ? "" : team.getName();
  }

  /** The sidebar's title before a match goes live: Red Warfare's lobby board. */
  static final Component LOBBY_TITLE = Component.text("Red Warfare", NamedTextColor.RED);

  /** The sidebar's title while a match is live and over: Red Warfare's game board. */
  static final Component GAME_TITLE = Component.text("Teams", NamedTextColor.GOLD);

  /** Red Warfare dropped the blank lines once a board grew past this many. */
  static final int MAX_LINES = 15;

  /**
   * Redraws the game board for {@code snapshot} while the match is live or over; before that the
   * lobby board ({@link #lobby}) is shown, as Red Warfare drew no game board before the start.
   */
  void render(MatchSnapshot snapshot) {
    if (snapshot.phase() == MatchSnapshot.PhaseKind.LIVE
        || snapshot.phase() == MatchSnapshot.PhaseKind.ENDED) {
      draw(GAME_TITLE, lines(snapshot));
    }
  }

  /** Redraws the lobby board for {@code status} until the match goes live. */
  void lobby(LobbyStatus status) {
    if (status.stage() != LobbyStatus.Stage.LIVE && status.stage() != LobbyStatus.Stage.ENDED) {
      draw(LOBBY_TITLE, lobbyLines(status));
    }
  }

  /**
   * Shows {@code lines} under {@code title}, only when something changed. Each line is its own
   * entry written in section-sign colours, as Red Warfare's boards were, ending in a distinct
   * invisible colour code so repeated lines (the blank ones) stay separate entries.
   */
  private void draw(Component title, List<Component> lines) {
    var entries = new ArrayList<String>();
    // A sidebar shows fifteen lines at most.
    for (var i = 0; i < Math.min(lines.size(), MAX_LINES); i++) {
      entries.add(
          LegacyComponentSerializer.legacySection().serialize(lines.get(i))
              + "§"
              + UNIQUE.charAt(i));
    }
    if (title.equals(shownTitle) && entries.equals(shown)) {
      return;
    }
    if (!title.equals(shownTitle)) {
      sidebar.displayName(title);
      shownTitle = title;
    }
    for (var entry : shown) {
      board.resetScores(entry);
    }
    for (var i = 0; i < entries.size(); i++) {
      sidebar.getScore(entries.get(i)).setScore(entries.size() - i);
    }
    shown = List.copyOf(entries);
  }

  /** One invisible colour code per line, so no two lines are the same entry. */
  private static final String UNIQUE = "0123456789abcdef";

  /**
   * Red Warfare's lobby board ({@code LobbyManager.drawScoreboard}): the map (or that it is being
   * voted on), how many are in the match, then the countdown or how many more players it waits for.
   */
  static List<Component> lobbyLines(LobbyStatus status) {
    var lines = new ArrayList<Component>();
    lines.add(Component.empty());
    lines.add(
        Component.text("Map: ", NamedTextColor.GOLD)
            .append(Component.text(status.map().orElse("Voting.."), NamedTextColor.YELLOW)));
    lines.add(
        Component.text("Players: ", NamedTextColor.GOLD)
            .append(
                Component.text(
                    String.valueOf(status.humans() + status.bots()), NamedTextColor.YELLOW)));
    lines.add(Component.empty());
    lines.add(
        Component.text(
            switch (status.stage()) {
              case EMPTY, WAITING ->
                  "Waiting for " + status.needed() + " player" + (status.needed() == 1 ? "" : "s");
              case COUNTDOWN, FREEZE -> "Game starting in " + status.secondsLeft();
              case PREPARING -> "Map loading..";
              case PREVIEW -> "Preview ends in " + status.secondsLeft();
              case RESETTING -> "Resetting the map";
              case LIVE, ENDED -> "";
            },
            NamedTextColor.YELLOW));
    return List.copyOf(lines);
  }

  /**
   * Red Warfare's game board ({@code SearchAndDestroy.drawScoreboard}): each team still alive, most
   * alive first, with how many are alive and its bomb; then the nukes.
   */
  static List<Component> lines(MatchSnapshot snapshot) {
    var teams =
        snapshot.teams().stream()
            .filter(team -> alive(snapshot, team) > 0)
            .sorted(
                Comparator.comparingLong((TeamColor team) -> -alive(snapshot, team))
                    .thenComparing(TeamColor::displayName, String.CASE_INSENSITIVE_ORDER))
            .toList();
    var nukes = snapshot.bombs().stream().filter(MatchSnapshot.BombView::nuke).toList();
    var lines = new ArrayList<Component>();
    for (var i = 0; i < teams.size(); i++) {
      lines.addAll(teamLines(snapshot, teams.get(i)));
      if (i < teams.size() - 1 || !nukes.isEmpty()) {
        lines.add(Component.empty());
      }
    }
    for (var nuke : nukes) {
      lines.add(
          switch (nuke.state()) {
            case MatchSnapshot.BombView.State.Armed armed ->
                Component.text(
                    "Nuke " + armed.remaining(),
                    nuke.team().map(Scoreboards::color).orElse(NamedTextColor.WHITE),
                    TextDecoration.BOLD);
            default -> Component.text("Nuke", Style.style(TextDecoration.BOLD));
          });
    }
    if (lines.size() > MAX_LINES) {
      lines.removeIf(Component.empty()::equals);
    }
    if (!lines.isEmpty() && lines.getLast().equals(Component.empty())) {
      lines.removeLast();
    }
    return List.copyOf(lines);
  }

  /** A team's block on the game board: its name, how many are alive, and its bombs. */
  private static List<Component> teamLines(MatchSnapshot snapshot, TeamColor team) {
    var lines = new ArrayList<Component>();
    lines.add(Component.text(team.displayName(), color(team), TextDecoration.BOLD));
    lines.add(Component.text(alive(snapshot, team) + " alive"));
    for (var bomb : snapshot.bombs()) {
      if (!bomb.nuke() && bomb.team().filter(team::equals).isPresent()) {
        bombLine(team, bomb).ifPresent(lines::add);
      }
    }
    return lines;
  }

  /**
   * A team bomb's line: "Bomb is Safe", "Bomb N" while it burns, or the defusing team's bar and the
   * time left while its owners defuse it. A bomb that went off has no line; its team is gone.
   */
  private static Optional<Component> bombLine(TeamColor team, MatchSnapshot.BombView bomb) {
    return switch (bomb.state()) {
      case MatchSnapshot.BombView.State.Armed armed ->
          Optional.of(
              armed
                  .defusing()
                  .map(
                      defusing ->
                          bar(defusing, "▍")
                              .append(Component.text(" "))
                              .append(
                                  Component.text(
                                      String.valueOf(armed.remaining()),
                                      color(team),
                                      TextDecoration.BOLD)))
                  .orElseGet(
                      () ->
                          Component.text("Bomb ", color(team))
                              .append(
                                  Component.text(
                                      String.valueOf(armed.remaining()),
                                      color(team),
                                      TextDecoration.BOLD))));
      case MatchSnapshot.BombView.State.Destroyed _ -> Optional.empty();
      case MatchSnapshot.BombView.State.Idle _, MatchSnapshot.BombView.State.Arming _ ->
          Optional.of(Component.text("Bomb is Safe"));
    };
  }

  /**
   * Red Warfare's ten-segment progress bar ({@code UtilTime.getProgress}): the share done in the
   * working team's colour, the rest dark red, shifted on by a twentieth as the original was.
   */
  static Component bar(MatchSnapshot.BombView.State.Arming arming, String segment) {
    var filled = (int) Math.clamp(Math.floor((arming.progress() + 0.05) * SEGMENTS), 0, SEGMENTS);
    return Component.text(segment.repeat(filled), color(arming.team()))
        .append(Component.text(segment.repeat(SEGMENTS - filled), NamedTextColor.DARK_RED));
  }

  /** The segments of Red Warfare's progress bars. */
  static final int SEGMENTS = 10;

  private static long alive(MatchSnapshot snapshot, TeamColor team) {
    return snapshot.combatants().stream()
        .filter(c -> c.alive() && c.team().filter(team::equals).isPresent())
        .count();
  }

  /** Clears team entries, kills and the sidebar between matches. */
  void reset() {
    for (var entry : List.copyOf(board.getEntries())) {
      board.resetScores(entry);
    }
    for (var team : board.getTeams()) {
      for (var entry : List.copyOf(team.getEntries())) {
        team.removeEntry(entry);
      }
    }
    for (var entry : shown) {
      board.resetScores(entry);
    }
    shown = List.of();
    shownTitle = Component.empty();
  }
}
