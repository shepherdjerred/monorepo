package com.shepherdjerred.thestorm.essentials.adapter.paper;

import com.shepherdjerred.thestorm.essentials.app.AfkTracker;
import io.papermc.paper.event.player.AsyncChatEvent;
import java.util.Locale;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerCommandPreprocessEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerMoveEvent;

/**
 * Reports activity to the AFK tracker and announces players coming back. Chat arrives on an async
 * thread; the announcement is scheduled onto the main thread.
 */
final class AfkListener implements Listener {

  private final PaperRuntime runtime;
  private final AfkTracker afk;
  private final PlayerCommands announcer;

  AfkListener(PaperRuntime runtime, AfkTracker afk, PlayerCommands announcer) {
    this.runtime = runtime;
    this.afk = afk;
    this.announcer = announcer;
  }

  /** Marks idle players away. Runs periodically on the main thread. */
  void sweep() {
    for (var id : afk.sweep()) {
      var player = runtime.server().getPlayer(id);
      if (player != null) {
        announcer.announceAfk(player, true);
      }
    }
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onMove(PlayerMoveEvent event) {
    if (event.hasChangedOrientation() || event.hasChangedBlock()) {
      active(event.getPlayer());
    }
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onInteract(PlayerInteractEvent event) {
    active(event.getPlayer());
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onCommand(PlayerCommandPreprocessEvent event) {
    // /afk toggles itself; counting it as activity would undo it.
    var command = event.getMessage().toLowerCase(Locale.ROOT);
    if (!"/afk".equals(command) && !command.startsWith("/afk ")) {
      active(event.getPlayer());
    }
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onChat(AsyncChatEvent event) {
    var player = event.getPlayer();
    if (afk.active(player.getUniqueId())) {
      runtime.scheduler().runOnMainThread(() -> announceBack(player));
    }
  }

  private void active(Player player) {
    if (afk.active(player.getUniqueId())) {
      announceBack(player);
    }
  }

  private void announceBack(Player player) {
    if (player.isOnline()) {
      announcer.announceAfk(player, false);
    }
  }
}
