package com.shepherdjerred.thestorm;

import com.shepherdjerred.thestorm.core.analytics.AnalyticsBootstrap;
import com.shepherdjerred.thestorm.core.analytics.AnalyticsRuntime;
import com.shepherdjerred.thestorm.core.expansion.ManagedGameplay;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.players.Humans;
import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.HandlerList;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;

/** Boot-scoped collection gate and human connection lifecycle. */
final class AnalyticsPaper implements Listener, AutoCloseable {
  private final ModuleContext context;
  private final AnalyticsRuntime analytics;
  private final Cancellable heartbeat;
  private boolean stopped;

  AnalyticsPaper(ModuleContext context, AnalyticsRuntime analytics) {
    this.context = context;
    this.analytics = analytics;
    context.plugin().getServer().getPluginManager().registerEvents(this, context.plugin());
    heartbeat =
        context
            .scheduler()
            .repeatOnMainThread(
                Duration.ofSeconds(60), Duration.ofSeconds(60), analytics::heartbeat);
  }

  void start(ManagedGameplay rollout) {
    var _ =
        rollout
            .enabled(ManagedGameplay.ANALYTICS, new UUID(0, 0))
            .thenComposeAsync(
                enabled -> {
                  if (!enabled || stopped) return CompletableFuture.completedFuture(null);
                  var bootstrap = AnalyticsBootstrap.fromEnvironment(System.getenv());
                  return analytics
                      .start(bootstrap, context.scheduler().mainThread())
                      .thenRun(
                          () -> {
                            for (var player : context.plugin().getServer().getOnlinePlayers()) {
                              if (Humans.isHuman(player))
                                analytics.joined(player.getUniqueId(), player.getName());
                            }
                          });
                },
                context.scheduler().mainThread())
            .whenComplete(
                (done, failure) -> {
                  if (failure != null)
                    context
                        .logger()
                        .error(
                            "Product analytics activation failed; collection remains disabled",
                            failure);
                });
  }

  @EventHandler(priority = EventPriority.MONITOR)
  void joined(PlayerJoinEvent event) {
    var player = event.getPlayer();
    if (Humans.isHuman(player)) analytics.joined(player.getUniqueId(), player.getName());
  }

  @EventHandler(priority = EventPriority.MONITOR)
  void left(PlayerQuitEvent event) {
    if (Humans.isHuman(event.getPlayer())) analytics.left(event.getPlayer().getUniqueId());
  }

  @Override
  public void close() {
    stopped = true;
    heartbeat.cancel();
    HandlerList.unregisterAll(this);
    analytics.close();
  }
}
