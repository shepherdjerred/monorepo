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

/** Personal build details beside the team's actual physical emerald balances. */
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
    var rows = rows(player);
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
        board.registerNewObjective("settlement", Criteria.DUMMY, Component.text("Settlement"));
    objective.setDisplaySlot(DisplaySlot.SIDEBAR);
    player.setScoreboard(board);
    return new Board(original, board, objective);
  }

  private List<Row> rows(Player player) {
    var rows = new ArrayList<Row>();
    rows.add(text("Round " + runner.game().round() + " · Team emeralds"));
    for (var teammate : runner.game().participants()) {
      var online = runner.context().server().getPlayer(teammate.id());
      if (online == null) continue;
      var balance = runner.items().count(online, org.bukkit.Material.EMERALD);
      rows.add(
          new Row(
              teammate.name()
                  + (runner.downed(teammate.id())
                      ? " · DOWN"
                      : runner.isFighter(teammate.id()) ? "" : " · WAIT"),
              NumberFormat.fixed(Component.text(balance))));
    }
    var build = runner.talents().build(player.getUniqueId());
    rows.add(text(" "));
    rows.add(text("Class · " + build.role()));
    rows.add(
        text(
            build
                .specialization()
                .map(
                    s ->
                        runner.map().content().classes().stream()
                            .flatMap(c -> c.specializations().stream())
                            .filter(p -> p.id() == s)
                            .findFirst()
                            .orElseThrow()
                            .name())
                .orElse("Choose a path after round 4")));
    rows.add(text("Potency " + build.potency() + " · Tempo " + build.tempo()));
    rows.add(
        text(
            build.pending() > 0
                ? build.pending() + " upgrade choices ready"
                : build.nextMilestone() == 0
                    ? "Class build complete"
                    : "Upgrade after round " + build.nextMilestone()));
    var next =
        java.util.Arrays.stream(
                com.shepherdjerred.thestorm.arena.domain.survival.SurvivalClass.values())
            .filter(c -> !c.unlocked(runner.xp(player.getUniqueId())))
            .findFirst();
    rows.add(
        text(
            next.map(
                    c -> "XP " + runner.xp(player.getUniqueId()) + "/" + c.requiredXp() + " · " + c)
                .orElseGet(() -> "All classes unlocked · XP " + runner.xp(player.getUniqueId()))));
    rows.add(text("Perks " + runner.actions().perks(player)));
    return rows;
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
