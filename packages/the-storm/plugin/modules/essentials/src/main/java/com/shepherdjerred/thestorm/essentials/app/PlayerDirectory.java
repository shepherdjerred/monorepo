package com.shepherdjerred.thestorm.essentials.app;

import com.shepherdjerred.thestorm.essentials.app.store.PlayerStore;
import com.shepherdjerred.thestorm.essentials.app.store.PlayerStore.KnownPlayer;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Last-known names of every player who has joined, in memory, so commands can name offline players
 * without asking Mojang or Paper's user cache on the main thread. Loaded at startup and updated on
 * every join.
 */
public final class PlayerDirectory {

  private final PlayerStore store;
  private final Map<UUID, KnownPlayer> byId = new ConcurrentHashMap<>();
  private final Map<String, KnownPlayer> byName = new ConcurrentHashMap<>();
  private final CompletableFuture<Void> loaded;

  private PlayerDirectory(PlayerStore store) {
    this.store = store;
    this.loaded = store.all().thenAccept(players -> players.forEach(this::remember));
  }

  /** Starts loading every known player from {@code store}. */
  public static PlayerDirectory load(PlayerStore store) {
    return new PlayerDirectory(store);
  }

  /** Completes once every known player has loaded. */
  public CompletableFuture<Void> loaded() {
    return loaded;
  }

  /**
   * Records a join after loading completes. Completes with true on the player's first join since
   * essentials started tracking.
   */
  public CompletableFuture<Boolean> joined(KnownPlayer player) {
    return loaded.thenCompose(
        ready -> {
          remember(player);
          return store.recordJoin(player);
        });
  }

  /** The player last seen with {@code name}, ignoring case. */
  public Optional<KnownPlayer> find(String name) {
    return Optional.ofNullable(byName.get(name.toLowerCase(Locale.ROOT)));
  }

  /** The last-known name of {@code player}. */
  public Optional<String> name(UUID player) {
    return Optional.ofNullable(byId.get(player)).map(KnownPlayer::name);
  }

  /** Every known name, for command suggestions. */
  public List<String> names() {
    return byId.values().stream().map(KnownPlayer::name).sorted().toList();
  }

  private void remember(KnownPlayer player) {
    var previous = byId.put(player.uuid(), player);
    if (previous != null) {
      byName.remove(previous.name().toLowerCase(Locale.ROOT), previous);
    }
    byName.merge(
        player.name().toLowerCase(Locale.ROOT),
        player,
        (old, next) -> next.lastSeen().isBefore(old.lastSeen()) ? old : next);
  }
}
