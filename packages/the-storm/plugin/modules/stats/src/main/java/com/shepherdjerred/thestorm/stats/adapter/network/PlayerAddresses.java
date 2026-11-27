package com.shepherdjerred.thestorm.stats.adapter.network;

import com.shepherdjerred.thestorm.stats.domain.GeoIpDatabase;
import java.util.Optional;
import org.bukkit.entity.Player;

/**
 * Extracts a player's peer {@link java.net.InetAddress} for in-memory RIR GeoIP country lookup
 * without exposing {@code java.net} types inside {@code adapter.paper} or performing DNS lookups.
 */
public final class PlayerAddresses {

  private PlayerAddresses() {}

  public static Optional<GeoIpDatabase.Country> countryOf(Player player, GeoIpDatabase geoIp) {
    var socketAddress = player.getAddress();
    if (socketAddress == null) {
      return Optional.empty();
    }
    return geoIp.lookup(socketAddress.getAddress());
  }
}
