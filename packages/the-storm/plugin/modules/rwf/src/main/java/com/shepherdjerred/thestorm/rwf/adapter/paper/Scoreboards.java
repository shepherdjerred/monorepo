package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
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
 * a sidebar with the phase, each team's living count and the bombs. Members see it while inside and
 * get the server's main board back when they leave.
 */
final class Scoreboards {

  static final String OBJECTIVE = "rwf";
  static final String BOT_SUFFIX = " ✦";

  private final Server server;
  private final Scoreboard board;
  private final Objective sidebar;
  private List<String> shown = List.of();

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
    this.sidebar =
        board.registerNewObjective(
            OBJECTIVE, Criteria.DUMMY, Component.text("Search and Destroy", NamedTextColor.RED));
    sidebar.setDisplaySlot(DisplaySlot.SIDEBAR);
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

  /**
   * Redraws the sidebar for {@code snapshot}, only when its text changed. Each line is its own
   * entry, so the text is the entry itself and no custom score names are needed.
   */
  void render(MatchSnapshot snapshot) {
    var lines = lines(snapshot);
    if (lines.equals(shown)) {
      return;
    }
    for (var entry : shown) {
      board.resetScores(entry);
    }
    for (var i = 0; i < lines.size(); i++) {
      sidebar.getScore(lines.get(i)).setScore(lines.size() - i);
    }
    shown = lines;
  }

  static List<String> lines(MatchSnapshot snapshot) {
    var lines = new ArrayList<String>();
    lines.add(
        switch (snapshot.phase()) {
          case LOBBY -> "Waiting for players";
          case COUNTDOWN -> "Starting soon";
          case LIVE -> "Live";
          case ENDED -> "Match over";
          case RESETTING -> "Resetting";
        });
    for (var team : snapshot.teams()) {
      var alive =
          snapshot.combatants().stream()
              .filter(c -> c.alive() && c.team().filter(team::equals).isPresent())
              .count();
      var total =
          snapshot.combatants().stream()
              .filter(c -> c.team().filter(team::equals).isPresent())
              .count();
      lines.add(team.shortName() + ": " + alive + "/" + total + " alive");
    }
    if (snapshot.phase() == MatchSnapshot.PhaseKind.LOBBY
        || snapshot.phase() == MatchSnapshot.PhaseKind.COUNTDOWN) {
      lines.add(snapshot.combatants().size() + " in the lobby");
    }
    for (var bomb : snapshot.bombs()) {
      var owner =
          bomb.nuke() ? "Nuke" : bomb.team().map(TeamColor::shortName).orElse("?") + " bomb";
      var state =
          switch (bomb.state()) {
            case MatchSnapshot.BombView.State.Idle _ -> "idle";
            case MatchSnapshot.BombView.State.Arming arming ->
                "arming " + Math.round(arming.progress() * 100) + "%";
            case MatchSnapshot.BombView.State.Armed armed -> "armed " + armed.remaining() + "s";
            case MatchSnapshot.BombView.State.Destroyed _ -> "gone";
          };
      lines.add(owner + ": " + state);
    }
    snapshot
        .poison()
        .ifPresent(poison -> lines.add("Poison in " + poison.untilDamage().toSeconds() + "s"));
    return List.copyOf(lines);
  }

  /** Clears team entries and the sidebar between matches. */
  void reset() {
    for (var team : board.getTeams()) {
      for (var entry : List.copyOf(team.getEntries())) {
        team.removeEntry(entry);
      }
    }
    for (var entry : shown) {
      board.resetScores(entry);
    }
    shown = List.of();
  }
}
