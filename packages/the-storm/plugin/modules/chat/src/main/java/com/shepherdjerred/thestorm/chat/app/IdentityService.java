package com.shepherdjerred.thestorm.chat.app;

import com.shepherdjerred.thestorm.chat.domain.Identity;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.UnaryOperator;

/** Identity changes become visible only after a durable write succeeds. */
public final class IdentityService {
  private final IdentityStore store;
  private final Map<UUID, Identity> identities = new ConcurrentHashMap<>();
  private final Set<UUID> writing = ConcurrentHashMap.newKeySet();
  private final Set<UUID> displaying = ConcurrentHashMap.newKeySet();
  private volatile boolean ready;

  public IdentityService(IdentityStore store) {
    this.store = store;
  }

  public CompletableFuture<Void> load() {
    return store
        .load()
        .thenAccept(
            rows -> {
              identities.putAll(rows);
              ready = true;
            });
  }

  public boolean ready() {
    return ready;
  }

  public Identity identity(UUID player) {
    return identities.getOrDefault(player, Identity.fresh());
  }

  public String display(UUID player, String realName) {
    return identity(player).nickname().orElse(realName);
  }

  public void displaying(UUID player, boolean enabled) {
    if (enabled) displaying.add(player);
    else displaying.remove(player);
  }

  public Identity effective(UUID player) {
    var stored = identity(player);
    return displaying.contains(player) ? stored : Identity.fresh();
  }

  public Optional<UUID> named(String nickname) {
    return identities.entrySet().stream()
        .filter(row -> row.getValue().nickname().filter(nickname::equalsIgnoreCase).isPresent())
        .map(Map.Entry::getKey)
        .findFirst();
  }

  public CompletableFuture<Identity> change(
      UUID player, UnaryOperator<Identity> action, IdentityStore.Audit audit) {
    if (!ready)
      return CompletableFuture.failedFuture(new IllegalStateException("Identities are loading."));
    if (!writing.add(player))
      return CompletableFuture.failedFuture(
          new IllegalStateException("An identity update is already in progress."));
    Identity next;
    try {
      next = action.apply(identity(player));
    } catch (RuntimeException failure) {
      writing.remove(player);
      return CompletableFuture.failedFuture(failure);
    }
    return store
        .save(player, next, audit)
        .thenApply(
            saved -> {
              identities.put(player, next);
              return next;
            })
        .whenComplete((value, failure) -> writing.remove(player));
  }
}
