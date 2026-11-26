package com.shepherdjerred.thestorm.stats.adapter.paper;

import com.shepherdjerred.thestorm.stats.adapter.network.PlayerAddresses;
import com.shepherdjerred.thestorm.stats.domain.GameModeBucket;
import com.shepherdjerred.thestorm.stats.domain.GeoIpDatabase;
import com.shepherdjerred.thestorm.stats.domain.Platform;
import com.shepherdjerred.thestorm.stats.domain.ProtocolVersions;
import com.shepherdjerred.thestorm.stats.domain.SessionLedger;
import com.shepherdjerred.thestorm.stats.domain.WorldBucket;
import com.shepherdjerred.thestorm.stats.domain.WorldClassifier;
import java.time.InstantSource;
import net.luckperms.api.LuckPerms;
import org.bukkit.GameMode;
import org.bukkit.Server;
import org.bukkit.entity.Player;
import org.jspecify.annotations.Nullable;

/** Reads live main-thread player metadata without touching blocking storage or network APIs. */
public final class PlayerStateReader {

  private final Server server;
  private final StatsPaperPorts ports;
  private final InstantSource time;
  private final GeoIpDatabase geoIp;

  public PlayerStateReader(Server server, StatsPaperPorts ports, InstantSource time) {
    this(server, ports, time, GeoIpDatabase.bundled());
  }

  public PlayerStateReader(
      Server server, StatsPaperPorts ports, InstantSource time, GeoIpDatabase geoIp) {
    this.server = server;
    this.ports = ports;
    this.time = time;
    this.geoIp = geoIp;
  }

  public boolean inArena(Player player) {
    return ports
        .arenaPresence()
        .flatMap(presence -> presence.arenaOf(player.getUniqueId()))
        .isPresent();
  }

  public WorldBucket worldOf(Player player) {
    return WorldClassifier.classifyWorld(player.getWorld().getName(), inArena(player));
  }

  public GameModeBucket modeOf(Player player, GameMode gameMode) {
    var arena = inArena(player);
    var world = WorldClassifier.classifyWorld(player.getWorld().getName(), arena);
    return WorldClassifier.classifyMode(world, arena, gameMode == GameMode.CREATIVE);
  }

  public boolean isAfk(Player player) {
    return ports.afkStatus().map(afk -> afk.isAfk(player.getUniqueId())).orElse(false);
  }

  public @Nullable Integer pingOf(Player player) {
    return SessionLedger.clampPing(player.getPing());
  }

  public SessionLedger.StateSample sample(Player player) {
    return sampleWithMode(player, player.getGameMode());
  }

  public SessionLedger.StateSample sampleWithMode(Player player, GameMode gameMode) {
    var arena = inArena(player);
    var world = WorldClassifier.classifyWorld(player.getWorld().getName(), arena);
    var mode = WorldClassifier.classifyMode(world, arena, gameMode == GameMode.CREATIVE);
    return new SessionLedger.StateSample(
        time.instant(), world, mode, isAfk(player), pingOf(player));
  }

  public SessionLedger.JoinInput joinInput(Player player, @Nullable String joinAddress) {
    var brand = player.getClientBrandName();
    var platform = Platform.detect(player.getUniqueId(), brand);
    var version = ProtocolVersions.clientVersion(platform, player.getProtocolVersion());
    var arena = inArena(player);
    var world = WorldClassifier.classifyWorld(player.getWorld().getName(), arena);
    var mode =
        WorldClassifier.classifyMode(world, arena, player.getGameMode() == GameMode.CREATIVE);
    var country = PlayerAddresses.countryOf(player, geoIp);
    return new SessionLedger.JoinInput(
        player.getUniqueId(),
        player.getName(),
        time.instant(),
        platform,
        version,
        brand,
        joinAddress,
        world,
        mode,
        isAfk(player),
        country.map(GeoIpDatabase.Country::code).orElse(null),
        country.map(GeoIpDatabase.Country::name).orElse(null));
  }

  public String primaryGroup(Player player) {
    try {
      var luckPerms = server.getServicesManager().load(LuckPerms.class);
      if (luckPerms != null) {
        var user = luckPerms.getUserManager().getUser(player.getUniqueId());
        if (user != null) {
          var group = user.getPrimaryGroup().strip();
          if (!group.isEmpty()) {
            return group.length() > 64 ? group.substring(0, 64) : group;
          }
        }
      }
    } catch (LinkageError | RuntimeException ignored) {
      // LuckPerms is optional in isolated MockBukkit suites; fall back to operator status.
      return player.isOp() ? "admin" : "default";
    }
    return player.isOp() ? "admin" : "default";
  }

  public @Nullable String nickname(Player player) {
    return ports
        .nicknames()
        .map(nicks -> nicks.display(player.getUniqueId(), player.getName()))
        .filter(display -> !display.isBlank() && !display.equals(player.getName()))
        .map(display -> display.length() > 64 ? display.substring(0, 64) : display)
        .orElse(null);
  }
}
