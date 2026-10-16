package com.shepherdjerred.thestorm.safety.adapter.grim;

import ac.grim.grimac.api.GrimAPIProvider;
import ac.grim.grimac.api.event.events.FlagEvent;
import com.shepherdjerred.thestorm.core.expansion.ManagedGameplay;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.safety.ContentSafety;
import com.shepherdjerred.thestorm.core.safety.ContentSubmission;
import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.permissions.PermissionAttachment;

/** Public Grim API only. Recording is unconditional; correction rollout never disables tracking. */
public final class GrimHooks implements Listener, AutoCloseable {
  private final ModuleContext context;
  private final ContentSafety safety;
  private final ManagedGameplay flags;
  private final Map<UUID, PermissionAttachment> controls = new HashMap<>();
  private final Cancellable refresh;

  public GrimHooks(ModuleContext context, ContentSafety safety) {
    this.context = context;
    this.safety = safety;
    flags = context.services().require(ManagedGameplay.class);
    var api = GrimAPIProvider.get();
    var plugin = api.getGrimPlugin(context.plugin());
    api.getEventBus()
        .get(FlagEvent.class)
        .onFlagSupplier(
            plugin,
            (user, check, verbose, cancelled) -> {
              var playerId = user.getUniqueId();
              var name = user.getName();
              var details =
                  check.getCheckName()
                      + " client="
                      + user.getVersionName()
                      + " ping="
                      + user.getTransactionPing()
                      + " "
                      + verbose.get();
              context
                  .scheduler()
                  .mainThread()
                  .execute(() -> journal(playerId, name, details, cancelled));
              return cancelled;
            });
    context.plugin().getServer().getPluginManager().registerEvents(this, context.plugin());
    context.plugin().getServer().getOnlinePlayers().forEach(this::install);
    refresh =
        context
            .scheduler()
            .repeatOnMainThread(
                Duration.ofSeconds(10),
                Duration.ofSeconds(10),
                () -> context.plugin().getServer().getOnlinePlayers().forEach(this::evaluate));
  }

  private void journal(UUID id, String name, String details, boolean cancelled) {
    var player = context.plugin().getServer().getPlayer(id);
    var object =
        player == null
            ? "disconnected"
            : player.getLocation()
                + " mode="
                + player.getGameMode()
                + " flying="
                + player.isFlying()
                + " allowFlight="
                + player.getAllowFlight()
                + " velocity="
                + player.getVelocity()
                + " effects="
                + player.getActivePotionEffects()
                + " gameplay="
                + safety.evidenceContext(id);
    var submission =
        new ContentSubmission(
            new UUID(context.random().nextLong(), context.random().nextLong()),
            id,
            name,
            "anticheat",
            "staff",
            details,
            "",
            object);
    var _ =
        safety
            .observe(submission, cancelled ? "grim-suppressed" : "grim-flag")
            .exceptionally(
                failure -> {
                  context
                      .logger()
                      .error("Anticheat evidence write failed: {}", submission.id(), failure);
                  return null;
                });
  }

  @EventHandler(priority = EventPriority.LOWEST)
  public void join(PlayerJoinEvent event) {
    install(event.getPlayer());
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void quit(PlayerQuitEvent event) {
    var attachment = controls.remove(event.getPlayer().getUniqueId());
    if (attachment != null) event.getPlayer().removeAttachment(attachment);
  }

  private void install(Player player) {
    if (controls.containsKey(player.getUniqueId())) return;
    controls.put(player.getUniqueId(), player.addAttachment(context.plugin()));
    apply(player, false);
    evaluate(player);
  }

  private void evaluate(Player player) {
    var _ =
        flags
            .enabled(ManagedGameplay.ANTICHEAT_CORRECTIONS, player.getUniqueId())
            .whenCompleteAsync(
                (enabled, failure) -> {
                  if (!player.isOnline()) return;
                  if (failure != null) {
                    context
                        .logger()
                        .error(
                            "Anticheat correction rollout unavailable; retaining detection only",
                            failure);
                    apply(player, false);
                  } else apply(player, Boolean.TRUE.equals(enabled));
                },
                context.scheduler().mainThread());
  }

  private void apply(Player player, boolean enabled) {
    var attachment = controls.get(player.getUniqueId());
    if (attachment == null) return;
    attachment.setPermission("grim.nosetback", !enabled);
    attachment.setPermission("grim.nomodifypacket", !enabled);
    var user = GrimAPIProvider.get().getGrimUser(player.getUniqueId());
    if (user != null) user.runSafely(user::updatePermissions);
  }

  @Override
  public void close() {
    refresh.cancel();
    GrimAPIProvider.get().getEventBus().unregisterAllListeners(context.plugin());
    context
        .plugin()
        .getServer()
        .getOnlinePlayers()
        .forEach(
            player -> {
              var attachment = controls.remove(player.getUniqueId());
              if (attachment != null) player.removeAttachment(attachment);
            });
    controls.clear();
  }
}
