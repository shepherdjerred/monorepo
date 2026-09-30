package com.shepherdjerred.thestorm.world.adapter.paper;

import com.shepherdjerred.thestorm.world.app.DailyLedger;
import com.shepherdjerred.thestorm.world.domain.DigestConfig;
import java.time.InstantSource;
import java.time.LocalDate;
import java.util.concurrent.CompletableFuture;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerChangedWorldEvent;
import org.bukkit.event.player.PlayerJoinEvent;

/** Records main-world arrivals and deaths as they occur; no periodic sampling is needed. */
public final class DailyActivityListener implements Listener {

  private final DigestConfig config;
  private final InstantSource time;
  private final DailyLedger ledger;
  private final ComponentLogger logger;

  public DailyActivityListener(
      DigestConfig config, InstantSource time, DailyLedger ledger, ComponentLogger logger) {
    this.config = config;
    this.time = time;
    this.ledger = ledger;
    this.logger = logger;
  }

  @EventHandler
  public void onJoin(PlayerJoinEvent event) {
    arrival(event.getPlayer());
  }

  @EventHandler
  public void onWorldChange(PlayerChangedWorldEvent event) {
    arrival(event.getPlayer());
  }

  @EventHandler
  public void onDeath(PlayerDeathEvent event) {
    if (!mainWorld(event.getPlayer())) {
      return;
    }
    var at = time.instant();
    observe(ledger.recordDeath(LocalDate.ofInstant(at, config.zone()), at), "player death");
  }

  private void arrival(Player player) {
    if (!mainWorld(player)) {
      return;
    }
    var at = time.instant();
    observe(
        ledger.recordArrival(LocalDate.ofInstant(at, config.zone()), player.getUniqueId(), at),
        "player arrival");
  }

  private boolean mainWorld(Player player) {
    return player.getWorld().getName().equals(config.world());
  }

  private void observe(CompletableFuture<Void> saved, String event) {
    var _ =
        saved.whenComplete(
            (ignored, error) -> {
              if (error != null) {
                logger.error("Could not record main-world {}", event, error);
              }
            });
  }
}
