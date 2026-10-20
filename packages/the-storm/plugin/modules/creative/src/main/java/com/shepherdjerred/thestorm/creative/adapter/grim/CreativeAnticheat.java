package com.shepherdjerred.thestorm.creative.adapter.grim;

import ac.grim.grimac.api.AbstractCheck;
import ac.grim.grimac.api.GrimAPIProvider;
import ac.grim.grimac.api.GrimUser;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.creative.domain.AnticheatExemption;
import java.time.Duration;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerChangedWorldEvent;
import org.bukkit.event.player.PlayerGameModeChangeEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;

/**
 * Flight and creative breaking are exempt only while the player's world is creative. Checks that
 * were already disabled stay disabled.
 */
public final class CreativeAnticheat implements Listener {

  private final String worldName;
  private final Scheduler scheduler;
  private final Logger logger;
  private final Map<UUID, Set<String>> paused = new ConcurrentHashMap<>();

  public CreativeAnticheat(String worldName, Scheduler scheduler, Logger logger) {
    this.worldName = worldName;
    this.scheduler = scheduler;
    this.logger = logger;
  }

  public void refreshOnline(Iterable<? extends Player> online) {
    for (var player : online) {
      refresh(player, false);
    }
  }

  /** Turns back on only the checks this module paused, including players still in creative. */
  public void restoreOnline(Iterable<? extends Player> online) {
    for (var player : online) {
      var user = user(player);
      if (user == null) {
        paused.remove(player.getUniqueId());
        continue;
      }
      user.runSafely(() -> apply(player.getUniqueId(), user, false));
    }
  }

  @EventHandler
  public void join(PlayerJoinEvent event) {
    refresh(event.getPlayer(), true);
  }

  @EventHandler
  public void changedWorld(PlayerChangedWorldEvent event) {
    refresh(event.getPlayer(), false);
  }

  /** Fires before the mode changes. The world name is what decides the exemption. */
  @EventHandler
  public void gameMode(PlayerGameModeChangeEvent event) {
    refresh(event.getPlayer(), false);
  }

  @EventHandler
  public void quit(PlayerQuitEvent event) {
    var player = event.getPlayer();
    var user = user(player);
    if (user == null) {
      paused.remove(player.getUniqueId());
      return;
    }
    user.runSafely(() -> apply(player.getUniqueId(), user, false));
  }

  private void refresh(Player player, boolean retry) {
    var user = user(player);
    if (user == null) {
      if (retry && player.isOnline()) {
        scheduler.runOnMainThreadLater(Duration.ofSeconds(1), () -> refresh(player, false));
      }
      return;
    }
    var inCreative = AnticheatExemption.inCreative(player.getWorld().getName(), worldName);
    user.runSafely(() -> apply(player.getUniqueId(), user, inCreative));
  }

  private @Nullable GrimUser user(Player player) {
    try {
      return GrimAPIProvider.get().getGrimUser(player.getUniqueId());
    } catch (RuntimeException failure) {
      logger.warn("Grim is installed but its API is not ready", failure);
      return null;
    }
  }

  private void apply(UUID id, GrimUser user, boolean inCreative) {
    if (!inCreative) {
      restore(id, user);
      return;
    }
    if (paused.containsKey(id)) {
      return;
    }
    var disabled = new LinkedHashSet<String>();
    for (var check : user.getChecks()) {
      if (check.isEnabled() && pauses(check)) {
        check.setEnabled(false);
        disabled.add(check.getCheckName());
      }
    }
    paused.put(id, Set.copyOf(disabled));
  }

  private void restore(UUID id, GrimUser user) {
    var names = paused.remove(id);
    if (names == null) {
      return;
    }
    for (var check : user.getChecks()) {
      if (names.contains(check.getCheckName())) {
        check.setEnabled(true);
      }
    }
  }

  private static boolean pauses(AbstractCheck check) {
    if (AnticheatExemption.pauses(check.getCheckName())) {
      return true;
    }
    var key = check.getStableKey();
    return key != null && AnticheatExemption.pauses(key);
  }
}
