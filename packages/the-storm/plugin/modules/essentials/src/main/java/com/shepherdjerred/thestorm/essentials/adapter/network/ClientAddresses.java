package com.shepherdjerred.thestorm.essentials.adapter.network;

import java.net.InetAddress;
import java.util.Optional;
import org.bukkit.event.player.AsyncPlayerPreLoginEvent;

/** Converts literal and proxy-forwarded addresses without resolving hostnames. */
public final class ClientAddresses {
  private ClientAddresses() {}

  /** A canonical public IP literal, never a hostname or shared local address. */
  public static Optional<String> publicAddress(String literal) {
    if (!literal.matches("[0-9a-fA-F:.]+")
        || (!literal.contains(":") && !literal.matches("[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+")))
      return Optional.empty();
    try {
      var address = InetAddress.ofLiteral(literal);
      return publicAddress(address) ? Optional.of(address.getHostAddress()) : Optional.empty();
    } catch (IllegalArgumentException invalid) {
      return Optional.empty();
    }
  }

  /** A public address forwarded by a distinct trusted private proxy peer. */
  public static Optional<String> forwarded(AsyncPlayerPreLoginEvent event) {
    var peer = event.getRawAddress();
    var forwarded = event.getAddress();
    return (peer.isSiteLocalAddress() || peer.isLoopbackAddress())
            && !peer.equals(forwarded)
            && publicAddress(forwarded)
        ? Optional.of(forwarded.getHostAddress())
        : Optional.empty();
  }

  private static boolean publicAddress(InetAddress address) {
    var bytes = address.getAddress();
    return !address.isAnyLocalAddress()
        && !address.isLoopbackAddress()
        && !address.isLinkLocalAddress()
        && !address.isSiteLocalAddress()
        && !address.isMulticastAddress()
        && !(bytes.length == 4
            && (Byte.toUnsignedInt(bytes[0]) == 0
                || (Byte.toUnsignedInt(bytes[0]) == 100
                    && Byte.toUnsignedInt(bytes[1]) >= 64
                    && Byte.toUnsignedInt(bytes[1]) <= 127)))
        && !(bytes.length == 16 && (Byte.toUnsignedInt(bytes[0]) & 0xfe) == 0xfc);
  }
}
