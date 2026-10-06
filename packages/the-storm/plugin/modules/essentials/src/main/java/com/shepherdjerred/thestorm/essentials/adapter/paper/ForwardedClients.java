package com.shepherdjerred.thestorm.essentials.adapter.paper;

import com.shepherdjerred.thestorm.core.expansion.ManagedGameplay;
import com.shepherdjerred.thestorm.essentials.adapter.network.ClientAddresses;
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
    return ClientAddresses.publicAddress(literal);
  }

  @EventHandler
  public void login(AsyncPlayerPreLoginEvent event) {
    addresses.remove(event.getUniqueId());
    ClientAddresses.forwarded(event)
        .ifPresent(address -> addresses.put(event.getUniqueId(), address));
    var actor = event.getUniqueId();
    var cached = flags.cachedEnabled(ManagedGameplay.IP, actor);
    flags.enabled(ManagedGameplay.IP, actor).exceptionally(_ -> flags.ipEnforcementDefault());
    var enforce =
        cached
            .or(() -> flags.lastKnownEnabled(ManagedGameplay.IP, actor))
            .or(() -> Optional.of(flags.ipEnforcementDefault()));
    if (!enforce.orElseThrow()) return;
    if (!ready.get()) {
      deny(event, "Staff state is still loading. Please retry shortly.");
      return;
    }
    var address = addresses.get(actor);
    if (address == null) {
      deny(event, "Your client address could not be verified. Please contact staff.");
      return;
    }
    ban.apply(address).ifPresent(reason -> deny(event, reason));
  }

  private static void deny(AsyncPlayerPreLoginEvent event, String reason) {
    event.disallow(AsyncPlayerPreLoginEvent.Result.KICK_OTHER, Component.text(reason));
  }
}
