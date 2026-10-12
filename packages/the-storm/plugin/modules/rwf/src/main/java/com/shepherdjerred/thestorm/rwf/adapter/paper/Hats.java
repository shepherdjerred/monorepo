// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/TeamGame.java#onHats and
// redwarfare-core/src/me/libraryaddict/core/data/TeamSettings.java); see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.app.MatchNotification;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.match.Combatant;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEvent;
import io.papermc.paper.event.player.PlayerTrackEntityEvent;
import org.bukkit.Color;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;

/**
 * Red Warfare's team hats, on by default there: everyone in the world sees each fighter wearing
 * their team's block (Red TNT, Blue diamond ore, Green leaves, Purple obsidian, Yellow gold). Only
 * what viewers are sent changes; the fighter's real helmet, its armor and the damage it takes are
 * untouched. The hats are sent as a fighter comes into view and every second, since the server
 * resends real equipment whenever armor changes. Main thread.
 */
final class Hats implements Listener {

  /** How many match ticks pass between sending every viewer every fighter's hat again. */
  static final int REFRESH_TICKS = 20;

  private final MatchRunner runner;
  private final PaperContext context;

  Hats(MatchRunner runner, PaperContext context) {
    this.runner = runner;
    this.context = context;
  }

  private int ticks;

  /** Hears the match: every {@link #REFRESH_TICKS}th tick of a started match resends the hats. */
  void accept(MatchNotification notification) {
    if (notification.event() instanceof MatchEvent.Tick && ++ticks % REFRESH_TICKS == 0) {
      refresh();
    }
  }

  /** The block {@code team} wears. */
  static Material hat(TeamColor team) {
    return switch (team) {
      case RED -> Material.TNT;
      case BLUE -> Material.DIAMOND_ORE;
      case GREEN -> Material.OAK_LEAVES;
      case PURPLE -> Material.OBSIDIAN;
      case YELLOW -> Material.GOLD_BLOCK;
    };
  }

  /** {@code team}'s leather dye. */
  static Color dye(TeamColor team) {
    return switch (team) {
      case RED -> Color.RED;
      case BLUE -> Color.BLUE;
      case GREEN -> Color.GREEN;
      case PURPLE -> Color.PURPLE;
      case YELLOW -> Color.YELLOW;
    };
  }

  /** A fighter came into a viewer's view: their hat goes with them, once the server has sent it. */
  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onTrack(PlayerTrackEntityEvent event) {
    if (event.getEntity() instanceof Player fighter && context.ours(fighter.getWorld())) {
      var viewer = event.getPlayer();
      context.scheduler().runOnMainThread(() -> send(viewer, fighter));
    }
  }

  private void refresh() {
    if (!runner.match().phase().started()) {
      return;
    }
    var world = context.mapWorld();
    var fighters = world.getPlayers();
    // Viewers are connected players (bots have no client to send to); fighters include bots.
    for (var viewer : context.server().getOnlinePlayers()) {
      if (viewer.getWorld().equals(world)) {
        for (var fighter : fighters) {
          send(viewer, fighter);
        }
      }
    }
  }

  private void send(Player viewer, Player fighter) {
    if (viewer.equals(fighter) || !viewer.isOnline() || !fighter.isOnline()) {
      return;
    }
    runner
        .memberOf(fighter.getUniqueId())
        .filter(Combatant::alive)
        .flatMap(Combatant::team)
        .ifPresent(
            team ->
                viewer.sendEquipmentChange(fighter, EquipmentSlot.HEAD, new ItemStack(hat(team))));
  }
}
