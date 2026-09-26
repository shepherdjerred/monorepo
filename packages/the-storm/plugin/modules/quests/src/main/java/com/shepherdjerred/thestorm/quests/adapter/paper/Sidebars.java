package com.shepherdjerred.thestorm.quests.adapter.paper;

import com.shepherdjerred.thestorm.core.text.HouseStyle;
import com.shepherdjerred.thestorm.quests.domain.view.Journal;
import io.papermc.paper.scoreboard.numbers.NumberFormat;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Server;
import org.bukkit.entity.Player;
import org.bukkit.scoreboard.Criteria;
import org.bukkit.scoreboard.DisplaySlot;
import org.bukkit.scoreboard.Scoreboard;

/**
 * The tracking sidebar: a scoreboard of the player's own with one line per objective of the tracked
 * quest, numbers hidden. Redrawn only when its text changes. A player tracking nothing gets the
 * server's main scoreboard back.
 */
final class Sidebars implements SidebarDisplay {

  private static final String OBJECTIVE = "thestorm_quest";

  private final Server server;
  private final Map<UUID, Scoreboard> boards = new HashMap<>();
  private final Map<UUID, Journal.Sidebar> shown = new HashMap<>();

  Sidebars(Server server) {
    this.server = server;
  }

  @Override
  public void show(Player player, Optional<Journal.Sidebar> sidebar) {
    var id = player.getUniqueId();
    if (sidebar.isEmpty()) {
      if (boards.remove(id) != null) {
        player.setScoreboard(server.getScoreboardManager().getMainScoreboard());
      }
      shown.remove(id);
      return;
    }
    if (sidebar.get().equals(shown.get(id))) {
      return;
    }
    shown.put(id, sidebar.get());
    var board =
        boards.computeIfAbsent(id, ignored -> server.getScoreboardManager().getNewScoreboard());
    var old = board.getObjective(OBJECTIVE);
    if (old != null) {
      old.unregister();
    }
    var objective =
        board.registerNewObjective(
            OBJECTIVE, Criteria.DUMMY, Component.text(sidebar.get().title(), HouseStyle.BRAND));
    objective.setDisplaySlot(DisplaySlot.SIDEBAR);
    objective.numberFormat(NumberFormat.blank());
    var lines = sidebar.get().lines();
    for (var index = 0; index < lines.size(); index++) {
      var score = objective.getScore("line" + index);
      score.setScore(lines.size() - index);
      var line = lines.get(index);
      score.customName(
          Component.text(line, line.startsWith("✔") ? NamedTextColor.GREEN : NamedTextColor.GRAY));
    }
    if (!board.equals(player.getScoreboard())) {
      player.setScoreboard(board);
    }
  }

  @Override
  public void forget(UUID player) {
    boards.remove(player);
    shown.remove(player);
  }
}
