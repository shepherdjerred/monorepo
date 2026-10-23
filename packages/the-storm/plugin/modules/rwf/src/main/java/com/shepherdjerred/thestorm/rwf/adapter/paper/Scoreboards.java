// Ported in part from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/SearchAndDestroy.java,
// setupScoreboards, and abilities/MedicAbility.java, its health display); see
// packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityEffect;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.lobby.LobbyStatus;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import io.papermc.paper.scoreboard.numbers.NumberFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.function.BiPredicate;
import java.util.function.Predicate;
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
 * The match's scoreboards, one per viewer as Red Warfare kept them. Before teams are dealt, and for
 * watchers, there is one neutral board. Once they are, each team sees its own board, and Medics a
 * copy of it that shows everyone's health under their name. Every board has a team per {@link
 * TeamColor} (name tags in the team's colour, no friendly fire, invisible teammates seen) with a
 * {@code <team>_bot} sub-team whose members carry a dim {@code ✦} suffix, a {@code <team>_hidden}
 * team whose name tags never show, and Red Warfare's sidebar: its lobby board until the match goes
 * live, then its game board of the teams still alive and their bombs, where a Saboteur's armed bomb
 * keeps its countdown from the teams it hides it from.
 *
 * <p>On a team's board an enemy Ghost or Wraith is on the hidden team, an enemy Spy is on the
 * viewer's own team, and an enemy Skinner wearing a skin is hidden too, its worn name drawn over it
 * by {@link KitDisplays}. Members see their board while inside and the server's main board again
 * when they leave.
 */
final class Scoreboards {

  static final String OBJECTIVE = "rwf";
  static final String HEALTH = "rwf_health";
  static final String BOT_SUFFIX = " ✦";

  /**
   * One combatant as the boards seat them.
   *
   * @param name their entry
   * @param team their team
   * @param bot whether they are a bot
   * @param invisible whether they are an invisible kit (Ghost, Wraith) while alive
   * @param disguise how they look to the enemy, if disguised
   */
  record Seat(
      String name,
      TeamColor team,
      boolean bot,
      boolean invisible,
      Optional<AbilityEffect.Disguised> disguise) {}

  /**
   * What a player looks at.
   *
   * @param team the team whose board, or empty for the neutral board
   * @param medic whether the Medic's copy
   */
  private record View(Optional<TeamColor> team, boolean medic) {}

  private final Server server;
  private final Scoreboard neutral;
  private final Map<TeamColor, Scoreboard> boards = new EnumMap<>(TeamColor.class);
  private final Map<TeamColor, Scoreboard> medics = new EnumMap<>(TeamColor.class);
  private final Map<Scoreboard, List<String>> shown = new HashMap<>();
  private final Map<Scoreboard, Component> titles = new HashMap<>();
  private final Map<UUID, View> views = new HashMap<>();
  private final Map<UUID, Seat> seats = new HashMap<>();
  private final Map<UUID, Looks> looks = new HashMap<>();

  /** How a combatant looks to the enemy, kept apart from their seat: kits start before seating. */
  private record Looks(boolean invisible, Optional<AbilityEffect.Disguised> disguise) {
    static final Looks PLAIN = new Looks(false, Optional.empty());
  }

  Scoreboards(Server server) {
    this.server = server;
    this.neutral = board(false);
    for (var color : TeamColor.values()) {
      boards.put(color, board(false));
      medics.put(color, board(true));
    }
  }

  private Scoreboard board(boolean medic) {
    var board = server.getScoreboardManager().getNewScoreboard();
    for (var color : TeamColor.values()) {
      team(board, teamName(color, false), color, false);
      team(board, teamName(color, true), color, true);
      var hidden = team(board, hiddenName(color), color, false);
      hidden.setOption(Team.Option.NAME_TAG_VISIBILITY, Team.OptionStatus.NEVER);
    }
    var sidebar = board.registerNewObjective(OBJECTIVE, Criteria.DUMMY, LOBBY_TITLE);
    sidebar.numberFormat(NumberFormat.blank());
    sidebar.setDisplaySlot(DisplaySlot.SIDEBAR);
    var _ = board.registerNewObjective(KILLS, Criteria.DUMMY, Component.text("Kills"));
    if (medic) {
      var health =
          board.registerNewObjective(
              HEALTH,
              Criteria.DUMMY,
              Component.text("% ").append(Component.text("❤", NamedTextColor.DARK_RED)));
      health.setDisplaySlot(DisplaySlot.BELOW_NAME);
    }
    shown.put(board, List.of());
    return board;
  }

  private static Team team(Scoreboard board, String name, TeamColor color, boolean bot) {
    var team = board.registerNewTeam(name);
    team.color(color(color));
    team.setAllowFriendlyFire(false);
    team.setCanSeeFriendlyInvisibles(true);
    team.setOption(Team.Option.NAME_TAG_VISIBILITY, Team.OptionStatus.ALWAYS);
    if (bot) {
      team.suffix(Component.text(BOT_SUFFIX, NamedTextColor.DARK_GRAY));
    }
    return team;
  }

  /** The tab list's score: kills this match, as Red Warfare showed them. */
  static final String KILLS = "rwf_kills";

  /** Shows (or hides) kills as the tab list score, on every board. */
  void showKills(boolean show) {
    for (var board : all()) {
      if (show) {
        Objects.requireNonNull(board.getObjective(KILLS)).setDisplaySlot(DisplaySlot.PLAYER_LIST);
      } else if (board.getObjective(DisplaySlot.PLAYER_LIST) != null) {
        board.clearSlot(DisplaySlot.PLAYER_LIST);
      }
    }
  }

  /** {@code name} has {@code count} kills on the tab list. */
  void kills(String name, int count) {
    for (var board : all()) {
      Objects.requireNonNull(board.getObjective(KILLS)).getScore(name).setScore(count);
    }
  }

  static String teamName(TeamColor color, boolean bot) {
    return "rwf_" + color.name().toLowerCase(Locale.ROOT) + (bot ? "_bot" : "");
  }

  static String hiddenName(TeamColor color) {
    return "rwf_" + color.name().toLowerCase(Locale.ROOT) + "_hidden";
  }

  static NamedTextColor color(TeamColor color) {
    return switch (color) {
      case RED -> NamedTextColor.RED;
      case BLUE -> NamedTextColor.BLUE;
      // Red Warfare's TeamSettings.GREEN coloured the team dark green (§2), name and all.
      case GREEN -> NamedTextColor.DARK_GREEN;
      case PURPLE -> NamedTextColor.DARK_PURPLE;
      case YELLOW -> NamedTextColor.YELLOW;
    };
  }

  private Scoreboard boardOf(View view) {
    if (view.team().isEmpty()) {
      return neutral;
    }
    var team = view.team().orElseThrow();
    return Objects.requireNonNull((view.medic() ? medics : boards).get(team));
  }

  private List<Scoreboard> all() {
    var all = new ArrayList<Scoreboard>();
    all.add(neutral);
    all.addAll(boards.values());
    all.addAll(medics.values());
    return all;
  }

  /** The neutral board, which watchers and the lobby see. */
  Scoreboard board() {
    return neutral;
  }

  /** The player sees the neutral match board, as in the lobby. */
  void show(Player player) {
    views.put(player.getUniqueId(), new View(Optional.empty(), false));
    player.setScoreboard(neutral);
  }

  /** The player is out: back to the server's board, off every team. */
  void hide(Player player) {
    unassign(player);
    views.remove(player.getUniqueId());
    player.setScoreboard(server.getScoreboardManager().getMainScoreboard());
  }

  /**
   * Seats {@code player} on {@code color} and shows them their team's board, the Medic's copy for a
   * Medic.
   */
  void assign(Player player, TeamColor color, boolean bot, boolean medic) {
    var look = looks.getOrDefault(player.getUniqueId(), Looks.PLAIN);
    seats.put(
        player.getUniqueId(),
        new Seat(player.getName(), color, bot, look.invisible(), look.disguise()));
    var view = new View(Optional.of(color), medic);
    views.put(player.getUniqueId(), view);
    player.setScoreboard(boardOf(view));
    reseat(seats.get(player.getUniqueId()));
  }

  void unassign(Player player) {
    var seat = seats.remove(player.getUniqueId());
    if (seat != null) {
      for (var board : all()) {
        var team = board.getEntryTeam(seat.name());
        if (team != null) {
          team.removeEntry(seat.name());
        }
      }
    }
  }

  /** {@code player} now looks this way to the enemy; their seat on every board follows. */
  void looks(Player player, boolean invisible, Optional<AbilityEffect.Disguised> disguise) {
    var look = new Looks(invisible, disguise);
    if (look.equals(Looks.PLAIN)) {
      looks.remove(player.getUniqueId());
    } else {
      looks.put(player.getUniqueId(), look);
    }
    var seat = seats.get(player.getUniqueId());
    if (seat == null) {
      return;
    }
    var next = new Seat(seat.name(), seat.team(), seat.bot(), invisible, disguise);
    seats.put(player.getUniqueId(), next);
    reseat(next);
  }

  /** Puts {@code seat} on the right team of every board. */
  private void reseat(Seat seat) {
    entry(neutral, seat, teamName(seat.team(), seat.bot()));
    for (var viewer : TeamColor.values()) {
      var team = teamFor(seat, viewer);
      entry(Objects.requireNonNull(boards.get(viewer)), seat, team);
      entry(Objects.requireNonNull(medics.get(viewer)), seat, team);
    }
  }

  /**
   * Whether enemies of {@code player} see no name tag over them: on every enemy board they sit on
   * their team's hidden team (an invisible kit, or a disguise wearing another's name).
   */
  boolean hiddenFromEnemies(UUID player) {
    var seat = seats.get(player);
    if (seat == null) {
      return false;
    }
    var hidden = hiddenName(seat.team());
    return Arrays.stream(TeamColor.values())
        .filter(viewer -> viewer != seat.team())
        .allMatch(viewer -> teamFor(seat, viewer).equals(hidden));
  }

  /** The team {@code seat} sits on in {@code viewer}'s board. */
  static String teamFor(Seat seat, TeamColor viewer) {
    if (seat.team() == viewer) {
      return teamName(seat.team(), seat.bot());
    }
    if (seat.invisible()) {
      return hiddenName(seat.team());
    }
    if (seat.disguise().isPresent()) {
      var disguise = seat.disguise().orElseThrow();
      return disguise.team().isEmpty() ? teamName(viewer, seat.bot()) : hiddenName(seat.team());
    }
    return teamName(seat.team(), seat.bot());
  }

  private static void entry(Scoreboard board, Seat seat, String teamName) {
    var team = Objects.requireNonNull(board.getTeam(teamName), "teams are registered at enable");
    if (team.hasEntry(seat.name())) {
      return;
    }
    // Leave the old team explicitly rather than relying on addEntry to move the entry.
    var before = board.getEntryTeam(seat.name());
    if (before != null) {
      before.removeEntry(seat.name());
    }
    team.addEntry(seat.name());
  }

  /** The team entry {@code player} is on in the neutral board, for tests and diagnostics. */
  String teamOf(Player player) {
    var team = neutral.getEntryTeam(player.getName());
    return team == null ? "" : team.getName();
  }

  /** The team entry {@code seated} is on in {@code viewer}'s board, for tests. */
  String teamOf(Player seated, TeamColor viewer) {
    var team = Objects.requireNonNull(boards.get(viewer)).getEntryTeam(seated.getName());
    return team == null ? "" : team.getName();
  }

  /** Every combatant's health, in percent, under their name on the Medics' boards. */
  void health(Player player, double health, double maxHealth) {
    var percent = (int) Math.ceil(health / maxHealth * 100);
    for (var board : medics.values()) {
      var objective = Objects.requireNonNull(board.getObjective(HEALTH));
      objective.getScore(player.getName()).setScore(percent);
    }
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
    render(snapshot, (bomb, viewer) -> false);
  }

  /**
   * As {@link #render(MatchSnapshot)}, with each team's board leaving out the countdown of the
   * armed bombs {@code concealed} keeps from that team (a Saboteur's work).
   */
  void render(MatchSnapshot snapshot, BiPredicate<MatchSnapshot.BombView, TeamColor> concealed) {
    if (snapshot.phase() != MatchSnapshot.PhaseKind.LIVE
        && snapshot.phase() != MatchSnapshot.PhaseKind.ENDED) {
      return;
    }
    draw(neutral, GAME_TITLE, lines(snapshot));
    for (var team : TeamColor.values()) {
      var lines = lines(snapshot, bomb -> concealed.test(bomb, team));
      draw(Objects.requireNonNull(boards.get(team)), GAME_TITLE, lines);
      draw(Objects.requireNonNull(medics.get(team)), GAME_TITLE, lines);
    }
  }

  /** Redraws the lobby board for {@code status} until the match goes live. */
  void lobby(LobbyStatus status) {
    if (status.stage() != LobbyStatus.Stage.LIVE && status.stage() != LobbyStatus.Stage.ENDED) {
      var lines = lobbyLines(status);
      for (var board : all()) {
        draw(board, LOBBY_TITLE, lines);
      }
    }
  }

  /**
   * Shows {@code lines} under {@code title}, only when something changed. Each line is its own
   * entry written in section-sign colours, as Red Warfare's boards were, ending in a distinct
   * invisible colour code so repeated lines (the blank ones) stay separate entries.
   */
  private void draw(Scoreboard board, Component title, List<Component> lines) {
    var entries = new ArrayList<String>();
    // A sidebar shows fifteen lines at most.
    for (var i = 0; i < Math.min(lines.size(), MAX_LINES); i++) {
      entries.add(
          LegacyComponentSerializer.legacySection().serialize(lines.get(i))
              + "§"
              + UNIQUE.charAt(i));
    }
    var before = shown.getOrDefault(board, List.of());
    if (title.equals(titles.get(board)) && entries.equals(before)) {
      return;
    }
    var sidebar = Objects.requireNonNull(board.getObjective(OBJECTIVE));
    if (!title.equals(titles.get(board))) {
      sidebar.displayName(title);
      titles.put(board, title);
    }
    for (var entry : before) {
      board.resetScores(entry);
    }
    for (var i = 0; i < entries.size(); i++) {
      sidebar.getScore(entries.get(i)).setScore(entries.size() - i);
    }
    shown.put(board, List.copyOf(entries));
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
    status.botStatus().ifPresent(value -> lines.add(Component.text(value, NamedTextColor.GRAY)));
    lines.add(Component.empty());
    lines.add(
        Component.text(
            switch (status.stage()) {
              case EMPTY, WAITING ->
                  "Waiting for " + status.needed() + " player" + (status.needed() == 1 ? "" : "s");
              case COUNTDOWN, FREEZE -> "Game starting in " + status.secondsLeft();
              case PREPARING -> "Map loading..";
              case CANDIDATES -> "Preparing visits..";
              case VOTING -> "Visit / vote: " + status.secondsLeft() + "s";
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
    return lines(snapshot, bomb -> false);
  }

  /** The game board, leaving out the countdown of the armed bombs {@code concealed} names. */
  static List<Component> lines(
      MatchSnapshot snapshot, Predicate<MatchSnapshot.BombView> concealed) {
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
      lines.addAll(teamLines(snapshot, teams.get(i), concealed));
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
  private static List<Component> teamLines(
      MatchSnapshot snapshot, TeamColor team, Predicate<MatchSnapshot.BombView> concealed) {
    var lines = new ArrayList<Component>();
    lines.add(Component.text(team.displayName(), color(team), TextDecoration.BOLD));
    lines.add(Component.text(alive(snapshot, team) + " alive"));
    for (var bomb : snapshot.bombs()) {
      if (!bomb.nuke() && bomb.team().filter(team::equals).isPresent()) {
        bombLine(team, bomb, concealed.test(bomb)).ifPresent(lines::add);
      }
    }
    return lines;
  }

  /**
   * A team bomb's line: "Bomb is Safe", "Bomb N" while it burns, or the defusing team's bar and the
   * time left while its owners defuse it. A bomb that went off has no line; its team is gone.
   */
  private static Optional<Component> bombLine(
      TeamColor team, MatchSnapshot.BombView bomb, boolean concealed) {
    if (concealed) {
      // A Saboteur's team armed it: its owners know it burns, not how long it has left.
      return Optional.of(
          Component.text("Bomb ", color(team))
              .append(Component.text("??", color(team), TextDecoration.BOLD)));
    }
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

  /** Clears team entries and every score (sidebar, kills, health) between matches. */
  void reset() {
    for (var board : all()) {
      for (var entry : List.copyOf(board.getEntries())) {
        board.resetScores(entry);
      }
      for (var team : board.getTeams()) {
        for (var entry : List.copyOf(team.getEntries())) {
          team.removeEntry(entry);
        }
      }
      shown.put(board, List.of());
      titles.remove(board);
      Objects.requireNonNull(board.getObjective(OBJECTIVE)).displayName(LOBBY_TITLE);
    }
    seats.clear();
    looks.clear();
  }

  /** The objective rendering the sidebar on the neutral board, for tests. */
  Objective sidebar() {
    return Objects.requireNonNull(neutral.getObjective(OBJECTIVE));
  }
}
