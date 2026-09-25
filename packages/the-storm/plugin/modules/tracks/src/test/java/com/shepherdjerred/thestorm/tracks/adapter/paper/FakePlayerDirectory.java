package com.shepherdjerred.thestorm.tracks.adapter.paper;

import static java.util.concurrent.CompletableFuture.completedFuture;

import com.shepherdjerred.thestorm.core.players.KnownPlayer;
import com.shepherdjerred.thestorm.core.players.PlayerDirectory;
import java.time.Instant;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;

/** Players a test says have joined, found by name ignoring case. */
final class FakePlayerDirectory implements PlayerDirectory {

  private final Map<String, KnownPlayer> byName = new ConcurrentHashMap<>();

  void joined(UUID uuid, String name) {
    byName.put(name.toLowerCase(Locale.ROOT), new KnownPlayer(uuid, name, Instant.EPOCH));
  }

  @Override
  public CompletableFuture<Optional<KnownPlayer>> byName(String name) {
    return CompletableFuture.supplyAsync(
        () -> Optional.ofNullable(byName.get(name.toLowerCase(Locale.ROOT))));
  }

  @Override
  public CompletableFuture<Optional<KnownPlayer>> byId(UUID uuid) {
    return completedFuture(
        byName.values().stream().filter(player -> player.uuid().equals(uuid)).findFirst());
  }
}
