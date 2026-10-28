package com.shepherdjerred.thestorm.core.reset;

import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Module-owned cleanup used to return one account to its first-join state. */
public final class PlayerResetRegistry {

  /** Deletes one module's persisted and cached state for a player. */
  @FunctionalInterface
  public interface Handler {
    CompletableFuture<Void> reset(UUID player);
  }

  private final Map<String, Handler> handlers = new LinkedHashMap<>();
  private final Set<String> early = new LinkedHashSet<>();
  private final Set<String> stateless = new LinkedHashSet<>();
  private java.util.function.Consumer<String> diagnostics = message -> {};
  private boolean complete;

  /** Enables stage diagnostics for this registry. */
  public void diagnostics(java.util.function.Consumer<String> diagnostics) {
    this.diagnostics = diagnostics;
  }

  /** Registers a state-owning module. */
  public void register(String module, Handler handler) {
    participate(module);
    handlers.put(module, handler);
  }

  /** Registers cleanup that must run while other modules' account permissions still exist. */
  public void registerEarly(String module, Handler handler) {
    register(module, handler);
    early.add(module);
  }

  /** Declares that a module has no human-account state to delete. */
  public void stateless(String module) {
    participate(module);
    stateless.add(module);
  }

  /** Verifies that core and every enabled module made an explicit declaration. */
  public void complete(Set<String> modules) {
    var expected = new LinkedHashSet<>(modules);
    expected.add("core");
    var participants = new LinkedHashSet<>(handlers.keySet());
    participants.addAll(stateless);
    if (!participants.equals(expected)) {
      var missing = new LinkedHashSet<>(expected);
      missing.removeAll(participants);
      var unexpected = new LinkedHashSet<>(participants);
      unexpected.removeAll(expected);
      throw new IllegalStateException(
          "Player reset declarations mismatch; missing=" + missing + ", unexpected=" + unexpected);
    }
    complete = true;
  }

  /** Runs early cleanup first, then remaining handlers in their registration order. */
  public CompletableFuture<Void> reset(UUID player) {
    if (!complete) {
      throw new IllegalStateException("Player reset registry is not complete");
    }
    var result = CompletableFuture.<Void>completedFuture(null);
    var ordered =
        handlers.entrySet().stream()
            .sorted(java.util.Comparator.comparing(entry -> !early.contains(entry.getKey())))
            .toList();
    for (var handler : ordered) {
      result =
          result.thenCompose(
              ignored -> {
                diagnostics.accept("Resetting module " + handler.getKey());
                return handler.getValue().reset(player);
              });
    }
    return result;
  }

  private void participate(String module) {
    if (complete) {
      throw new IllegalStateException("Player reset registry is already complete");
    }
    if (handlers.containsKey(module) || stateless.contains(module)) {
      throw new IllegalStateException("Duplicate player reset declaration for " + module);
    }
  }
}
