package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.shepherdjerred.thestorm.essentials.app.AfkStatus;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import org.bukkit.GameRules;
import org.bukkit.World;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.world.WorldLoadEvent;

/**
 * The sleep vote is vanilla's: every overworld gets the configured {@code
 * players_sleeping_percentage}, and players marked AFK are set to be ignored for sleeping (unless
 * they are in bed) so an idle player never keeps the night going. Vanilla also clears the weather
 * when the night is skipped. Only the ignore flags qol set are ever cleared. Main thread only.
 */
final class SleepListener implements Listener {

  private final QolRuntime runtime;
  private final AfkStatus afk;
  private final int percent;
  private final Set<UUID> ignoredByUs = new HashSet<>();

  SleepListener(QolRuntime runtime, AfkStatus afk, int percent) {
    this.runtime = runtime;
    this.afk = afk;
    this.percent = percent;
  }

  /** Sets the rule on every loaded overworld. */
  void start() {
    runtime.server().getWorlds().forEach(this::setRule);
  }

  @EventHandler(priority = EventPriority.MONITOR)
  void onWorldLoad(WorldLoadEvent event) {
    setRule(event.getWorld());
  }

  private void setRule(World world) {
    if (world.getEnvironment() == World.Environment.NORMAL) {
      world.setGameRule(GameRules.PLAYERS_SLEEPING_PERCENTAGE, percent);
    }
  }

  /** Every second: AFK players are left out of the count; players back from AFK count again. */
  void tick() {
    for (var player : runtime.server().getOnlinePlayers()) {
      if (!com.shepherdjerred.thestorm.core.players.Humans.isHuman(player)) {
        player.setSleepingIgnored(true);
        continue;
      }
      var id = player.getUniqueId();
      var leaveOut = afk.isAfk(id) && !player.isSleeping();
      if (leaveOut && !player.isSleepingIgnored()) {
        player.setSleepingIgnored(true);
        ignoredByUs.add(id);
      } else if (!leaveOut && ignoredByUs.remove(id)) {
        player.setSleepingIgnored(false);
      }
    }
  }

  @EventHandler(priority = EventPriority.MONITOR)
  void onQuit(PlayerQuitEvent event) {
    if (!com.shepherdjerred.thestorm.core.players.Humans.isHuman(event.getPlayer())) return;
    release(event.getPlayer());
  }

  /** Clears every flag qol set (the module is stopping). */
  void stop() {
    runtime.server().getOnlinePlayers().forEach(this::release);
    ignoredByUs.clear();
  }

  private void release(Player player) {
    if (ignoredByUs.remove(player.getUniqueId())) {
      player.setSleepingIgnored(false);
    }
  }
}
