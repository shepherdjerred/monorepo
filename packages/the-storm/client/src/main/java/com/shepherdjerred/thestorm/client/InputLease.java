package com.shepherdjerred.thestorm.client;

import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.jspecify.annotations.Nullable;

/** Client-thread-owned, bounded inputs; a disconnected peer cannot leave movement held. */
final class InputLease {
  static final Set<String> BUTTONS =
      Set.of("forward", "back", "left", "right", "jump", "sneak", "sprint", "attack", "use");

  private @Nullable UUID owner;
  private int remaining;
  private Set<String> buttons = Set.of();
  private @Nullable CompletableFuture<Object> completion;

  Set<String> buttons() {
    return buttons;
  }

  boolean active() {
    return owner != null;
  }

  CompletableFuture<Object> start(UUID peer, Set<String> requested, int ticks) {
    if (owner != null) throw new IllegalStateException("Another input is still running");
    if (ticks < 1 || ticks > 100 || requested.isEmpty() || !BUTTONS.containsAll(requested)) {
      throw new IllegalArgumentException("Invalid input buttons or ticks (1–100)");
    }
    owner = peer;
    remaining = ticks;
    buttons = Set.copyOf(requested);
    var result = new CompletableFuture<Object>();
    completion = result;
    return result;
  }

  void tick() {
    if (owner == null) return;
    remaining--;
    if (remaining == 0) finish(false);
  }

  void disconnect(UUID peer) {
    if (peer.equals(owner)) finish(true);
  }

  void release() {
    if (owner != null) finish(true);
  }

  private void finish(boolean cancelled) {
    var result = completion;
    owner = null;
    remaining = 0;
    buttons = Set.of();
    completion = null;
    if (result == null) throw new IllegalStateException("Input lease lost its completion");
    if (cancelled) result.completeExceptionally(new IllegalStateException("Input cancelled"));
    else result.complete("Input completed");
  }
}
