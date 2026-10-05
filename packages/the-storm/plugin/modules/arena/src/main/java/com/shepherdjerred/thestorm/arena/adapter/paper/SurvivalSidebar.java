package com.shepherdjerred.thestorm.arena.adapter.paper;

import io.papermc.paper.scoreboard.numbers.NumberFormat;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import org.bukkit.entity.Player;
import org.bukkit.scoreboard.Criteria;
import org.bukkit.scoreboard.DisplaySlot;
import org.bukkit.scoreboard.Objective;
import org.bukkit.scoreboard.Scoreboard;

/** Round and currency remain visible; class details belong in the optional class menu. */
final class SurvivalSidebar {
  private record Board(Scoreboard original, Scoreboard owned, Objective objective) {}

  private record Row(String label, NumberFormat number) {}

  private final SurvivalRunner runner;
  private final Map<UUID, Board> boards = new HashMap<>();

  SurvivalSidebar(SurvivalRunner runner) {
    this.runner = runner;
  }

  void tick(Player player) {
    if (runner.game().player(player.getUniqueId()).orElseThrow().status()
        == com.shepherdjerred.thestorm.arena.domain.survival.Survivor.Status.JOINING) return;
    var board = boards.computeIfAbsent(player.getUniqueId(), _ -> create(player));
    var rows = rows();
    for (var i = 0; i < 15; i++) {
      var score = board.objective().getScore("row:" + i);
      if (i >= rows.size()) {
        score.resetScore();
        continue;
      }
      score.setScore(15 - i);
      score.customName(Component.text(rows.get(i).label()));
      score.numberFormat(rows.get(i).number());
    }
  }

  private Board create(Player player) {
    var original = player.getScoreboard();
    var board =
        java.util.Objects.requireNonNull(runner.context().server().getScoreboardManager())
            .getNewScoreboard();
    var objective =
        board.registerNewObjective(
            runner.id(), Criteria.DUMMY, Component.text(runner.world().definition().name()));
    objective.setDisplaySlot(DisplaySlot.SIDEBAR);
    player.setScoreboard(board);
    return new Board(original, board, objective);
  }

  private List<Row> rows() {
    var rows = new ArrayList<Row>();
    rows.add(text("Round " + runner.game().round() + " · Team emeralds"));
    for (var teammate : runner.game().participants()) {
      var online = runner.context().server().getPlayer(teammate.id());
      if (online == null) continue;
      var balance = runner.items().count(online, org.bukkit.Material.EMERALD);
      rows.add(
          new Row(teammate.name() + status(teammate), NumberFormat.fixed(Component.text(balance))));
    }
    rows.add(
        new Row(
            "Team bank",
            NumberFormat.fixed(Component.text(runner.items().bank().supplies().count("EMERALD")))));
    return rows;
  }

  private String status(com.shepherdjerred.thestorm.arena.domain.survival.Survivor teammate) {
    if (teammate.status()
        == com.shepherdjerred.thestorm.arena.domain.survival.Survivor.Status.LOBBY)
      return teammate.ready() ? " · READY" : " · NOT READY";
    if (runner.downed(teammate.id())) return " · DOWN";
    return runner.isFighter(teammate.id()) ? "" : " · WAIT";
  }

  private static Row text(String value) {
    return new Row(value, NumberFormat.blank());
  }

  void leave(Player player) {
    var board = boards.remove(player.getUniqueId());
    if (board != null && player.getScoreboard().equals(board.owned()))
      player.setScoreboard(board.original());
  }
}
