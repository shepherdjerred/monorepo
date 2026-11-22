package com.shepherdjerred.thestorm.stats.adapter.paper;

import com.shepherdjerred.thestorm.core.players.Humans;
import com.shepherdjerred.thestorm.stats.app.StatsService;
import com.shepherdjerred.thestorm.stats.domain.BounceClassifier;
import com.shepherdjerred.thestorm.stats.domain.EndReason;
import com.shepherdjerred.thestorm.stats.domain.JoinAddresses;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.AsyncPlayerPreLoginEvent;
import org.bukkit.event.player.PlayerChangedWorldEvent;
import org.bukkit.event.player.PlayerGameModeChangeEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerKickEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.jspecify.annotations.Nullable;

/** Captures human session lifecycles, world/mode transitions, and connection bounces. */
public final class StatsSessionListener implements Listener {

  private static final int MAX_PENDING_HOSTS = 512;
  private static final PlainTextComponentSerializer PLAIN =
      PlainTextComponentSerializer.plainText();

  private final StatsService service;
  private final PlayerStateReader stateReader;
  private final Map<UUID, String> pendingJoinAddresses = new ConcurrentHashMap<>();
  private final Set<UUID> kickedPlayers = new HashSet<>();

  public StatsSessionListener(StatsService service, PlayerStateReader stateReader) {
    this.service = service;
    this.stateReader = stateReader;
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void onPreLogin(AsyncPlayerPreLoginEvent event) {
    var host = JoinAddresses.normalize(event.getHostname());
    if (event.getLoginResult() == AsyncPlayerPreLoginEvent.Result.ALLOWED) {
      rememberHost(event.getUniqueId(), host);
      return;
    }
    pendingJoinAddresses.remove(event.getUniqueId());
    var rawReason = plain(event.kickMessage());
    var category = BounceClassifier.classifyPreLogin(event.getLoginResult().name(), rawReason);
    service.recordBounce(
        new StatsService.BounceInput(
            event.getUniqueId(),
            event.getName(),
            category,
            BounceClassifier.sanitizeReason(rawReason),
            host));
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void onJoin(PlayerJoinEvent event) {
    var player = event.getPlayer();
    if (!Humans.isHuman(player)) {
      return;
    }
    kickedPlayers.remove(player.getUniqueId());
    var host = pendingJoinAddresses.remove(player.getUniqueId());
    service.playerJoined(stateReader.joinInput(player, host));
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void onWorldChange(PlayerChangedWorldEvent event) {
    var player = event.getPlayer();
    if (!Humans.isHuman(player)) {
      return;
    }
    service.syncState(player.getUniqueId(), stateReader.sample(player));
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  public void onGameModeChange(PlayerGameModeChangeEvent event) {
    var player = event.getPlayer();
    if (!Humans.isHuman(player)) {
      return;
    }
    service.syncState(
        player.getUniqueId(), stateReader.sampleWithMode(player, event.getNewGameMode()));
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  public void onKick(PlayerKickEvent event) {
    var player = event.getPlayer();
    if (!Humans.isHuman(player)) {
      return;
    }
    kickedPlayers.add(player.getUniqueId());
    var rawReason = plain(event.reason());
    var category = BounceClassifier.classifyKick(event.getCause().name(), rawReason);
    service.recordBounce(
        new StatsService.BounceInput(
            player.getUniqueId(),
            player.getName(),
            category,
            BounceClassifier.sanitizeReason(rawReason),
            null));
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void onQuit(PlayerQuitEvent event) {
    var player = event.getPlayer();
    if (!Humans.isHuman(player)) {
      return;
    }
    var uuid = player.getUniqueId();
    pendingJoinAddresses.remove(uuid);
    boolean kicked =
        kickedPlayers.remove(uuid) || event.getReason() == PlayerQuitEvent.QuitReason.KICKED;
    service.playerLeft(
        uuid, kicked ? EndReason.KICK : EndReason.DISCONNECT, stateReader.pingOf(player));
  }

  private void rememberHost(UUID playerUuid, @Nullable String host) {
    if (host == null) {
      pendingJoinAddresses.remove(playerUuid);
      return;
    }
    if (pendingJoinAddresses.size() >= MAX_PENDING_HOSTS) {
      var iterator = pendingJoinAddresses.keySet().iterator();
      if (iterator.hasNext()) {
        pendingJoinAddresses.remove(iterator.next());
      }
    }
    pendingJoinAddresses.put(playerUuid, host);
  }

  private static String plain(@Nullable Component component) {
    return component == null ? "" : PLAIN.serialize(component);
  }
}
