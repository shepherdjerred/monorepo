// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/Game.java, onAfkMove); see
// packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.match.MatchEvent;
import org.bukkit.Location;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerMoveEvent;

/**
 * Red Warfare's AFK check: a human who is still marked AFK in a live match stops being AFK the
 * first time their whole-degree yaw or pitch changes while they are alive. Walking without turning
 * the head does not count, exactly as in the original. Only the first look is sent to the match.
 */
final class AfkWatch implements Listener {

  private final MatchRunner runner;

  AfkWatch(MatchRunner runner) {
    this.runner = runner;
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onMove(PlayerMoveEvent event) {
    if (!runner.live() || !turned(event.getFrom(), event.getTo())) {
      return;
    }
    runner
        .memberOf(event.getPlayer().getUniqueId())
        .filter(member -> !member.id().isBot() && member.alive() && member.afk())
        .ifPresent(member -> runner.handle(new MatchEvent.LookedAround(member.id())));
  }

  /** Whether the whole-degree yaw or pitch changed, as the original compared them. */
  static boolean turned(Location from, Location to) {
    return (int) from.getPitch() != (int) to.getPitch() || (int) from.getYaw() != (int) to.getYaw();
  }
}
