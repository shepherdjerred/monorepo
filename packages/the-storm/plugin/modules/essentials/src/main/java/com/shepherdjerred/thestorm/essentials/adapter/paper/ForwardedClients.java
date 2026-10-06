package com.shepherdjerred.thestorm.essentials.adapter.paper;

import com.shepherdjerred.thestorm.core.expansion.ManagedGameplay;
import java.net.InetAddress;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;
import java.util.function.Supplier;
import net.kyori.adventure.text.Component;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.AsyncPlayerPreLoginEvent;

/**
 * Public addresses verified through a trusted private PROXY-protocol peer, never a shared proxy IP.
 */
final class ForwardedClients implements Listener {
  private final Map<UUID, String> addresses = new ConcurrentHashMap<>();
  private final ManagedGameplay flags;
  private final Supplier<Boolean> ready;
  private final Function<String, Optional<String>> ban;

  ForwardedClients(
      ManagedGameplay flags, Supplier<Boolean> ready, Function<String, Optional<String>> ban) {
    this.flags = flags;
    this.ready = ready;
    this.ban = ban;
  }

  Optional<String> verified(UUID player) {
    return Optional.ofNullable(addresses.get(player));
  }

  static Optional<String> publicAddress(String literal) {
    if (!literal.matches("[0-9a-fA-F:.]+")
        || (!literal.contains(":") && !literal.matches("[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+")))
      return Optional.empty();
    try {
      var address = InetAddress.getByName(literal);
      return publicAddress(address) ? Optional.of(address.getHostAddress()) : Optional.empty();
    } catch (java.net.UnknownHostException invalid) {
      return Optional.empty();
    }
  }

  private static boolean publicAddress(InetAddress address) {
    return !address.isAnyLocalAddress()
        && !address.isLoopbackAddress()
        && !address.isLinkLocalAddress()
        && !address.isSiteLocalAddress()
        && !address.isMulticastAddress()
        && !(address.getAddress().length == 4
            && (Byte.toUnsignedInt(address.getAddress()[0]) == 0
                || (Byte.toUnsignedInt(address.getAddress()[0]) == 100
                    && Byte.toUnsignedInt(address.getAddress()[1]) >= 64
                    && Byte.toUnsignedInt(address.getAddress()[1]) <= 127)))
        && !(address.getAddress().length == 16
            && (Byte.toUnsignedInt(address.getAddress()[0]) & 0xfe) == 0xfc);
  }

  @EventHandler
  public void login(AsyncPlayerPreLoginEvent event) {
    addresses.remove(event.getUniqueId());
    if (!ready.get()) {
      deny(event, "Staff state is still loading. Please retry shortly.");
      return;
    }
    var peer = event.getRawAddress();
    var forwarded = event.getAddress();
    if ((peer.isSiteLocalAddress() || peer.isLoopbackAddress())
        && !peer.equals(forwarded)
        && publicAddress(forwarded)) addresses.put(event.getUniqueId(), forwarded.getHostAddress());
    evaluate(event);
  }

  private void evaluate(AsyncPlayerPreLoginEvent event) {
    try {
      if (!flags.enabled(ManagedGameplay.IP, event.getUniqueId()).join()) return;
      var address = addresses.get(event.getUniqueId());
      if (address == null) {
        deny(event, "Your client address could not be verified. Please contact staff.");
        return;
      }
      ban.apply(address).ifPresent(reason -> deny(event, reason));
    } catch (java.util.concurrent.CompletionException failure) {
      if (!flags.ipEnforcementDefault()) return;
      deny(event, "Login checks are unavailable. Please retry shortly.");
    }
  }

  private static void deny(AsyncPlayerPreLoginEvent event, String reason) {
    event.disallow(AsyncPlayerPreLoginEvent.Result.KICK_OTHER, Component.text(reason));
  }
}
