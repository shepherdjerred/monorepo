package com.shepherdjerred.thestorm.economy.adapter.paper;

import com.mojang.brigadier.suggestion.Suggestions;
import com.mojang.brigadier.suggestion.SuggestionsBuilder;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.bukkit.Server;
import org.bukkit.entity.Player;

/**
 * A player the server knows by name, online or not.
 *
 * @param uuid their id
 * @param name their current name
 */
record KnownPlayer(UUID uuid, String name) {

  AccountId.Player account() {
    return new AccountId.Player(uuid);
  }

  /**
   * Finds {@code name} among online players, then in the server's profile cache. Never asks Mojang,
   * so it is safe on the main thread.
   */
  static Optional<KnownPlayer> find(Server server, String name) {
    Player online = server.getPlayerExact(name);
    if (online != null) {
      return Optional.of(new KnownPlayer(online.getUniqueId(), online.getName()));
    }
    var cached = server.getOfflinePlayerIfCached(name);
    if (cached == null) {
      return Optional.empty();
    }
    var cachedName = cached.getName();
    return Optional.of(
        new KnownPlayer(cached.getUniqueId(), cachedName != null ? cachedName : name));
  }

  /** The name to show for {@code uuid}: the last name the server saw, or the id if it has none. */
  static String nameOf(Server server, UUID uuid) {
    var name = server.getOfflinePlayer(uuid).getName();
    return name != null ? name : uuid.toString();
  }

  /** Suggests online player names starting with {@code prefix}, ignoring case. */
  static CompletableFuture<Suggestions> suggest(Server server, SuggestionsBuilder builder) {
    var prefix = builder.getRemainingLowerCase();
    for (var player : server.getOnlinePlayers()) {
      if (player.getName().toLowerCase(Locale.ROOT).startsWith(prefix)) {
        builder.suggest(player.getName());
      }
    }
    return builder.buildFuture();
  }
}
