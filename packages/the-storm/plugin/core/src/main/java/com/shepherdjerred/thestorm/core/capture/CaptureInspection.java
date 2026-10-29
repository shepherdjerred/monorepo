package com.shepherdjerred.thestorm.core.capture;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Function;

/** Module-owned inspectors run on the main thread and fail while state is unavailable. */
public final class CaptureInspection {
  private final Map<String, Function<CaptureArea, String>> inspectors = new LinkedHashMap<>();
  private final Map<String, Function<java.util.UUID, String>> playerInspectors =
      new LinkedHashMap<>();
  private final Map<
          String,
          java.util.function.BiFunction<
              java.util.UUID, String, java.util.concurrent.CompletableFuture<Void>>>
      cleanup = new LinkedHashMap<>();

  public void registerCleanup(
      String resource,
      java.util.function.BiFunction<
              java.util.UUID, String, java.util.concurrent.CompletableFuture<Void>>
          remove) {
    if (cleanup.putIfAbsent(resource, remove) != null)
      throw new IllegalStateException("Duplicate capture cleanup " + resource);
  }

  public java.util.concurrent.CompletableFuture<Void> cleanup(
      java.util.UUID player, String resource, String id) {
    var remove = cleanup.get(resource);
    if (remove == null) throw new IllegalArgumentException("Unknown capture resource " + resource);
    return remove.apply(player, id);
  }

  public void registerPlayer(String name, Function<java.util.UUID, String> inspect) {
    if (playerInspectors.putIfAbsent(name, inspect) != null)
      throw new IllegalStateException("Duplicate capture player inspector " + name);
  }

  public Map<String, String> player(java.util.UUID player) {
    var result = new LinkedHashMap<String, String>();
    playerInspectors.forEach((name, inspect) -> result.put(name, inspect.apply(player)));
    return Map.copyOf(result);
  }

  public void register(String name, Function<CaptureArea, String> inspect) {
    if (inspectors.putIfAbsent(name, inspect) != null)
      throw new IllegalStateException("Duplicate capture inspector " + name);
  }

  public Map<String, String> inspect(CaptureArea area) {
    var result = new LinkedHashMap<String, String>();
    inspectors.forEach((name, inspect) -> result.put(name, inspect.apply(area)));
    return Map.copyOf(result);
  }
}
