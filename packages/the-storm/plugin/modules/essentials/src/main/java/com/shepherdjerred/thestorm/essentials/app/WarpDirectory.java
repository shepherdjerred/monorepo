package com.shepherdjerred.thestorm.essentials.app;

import com.shepherdjerred.thestorm.essentials.app.store.WarpStore;
import com.shepherdjerred.thestorm.essentials.domain.place.PlaceName;
import com.shepherdjerred.thestorm.essentials.domain.place.Warp;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;

/** Server warps, held in memory so {@code /warp} resolves on the main thread. */
public final class WarpDirectory {

  private final WarpStore store;
  private final Map<PlaceName, Warp> warps = new ConcurrentHashMap<>();
  private final CompletableFuture<Void> loaded;

  private WarpDirectory(WarpStore store) {
    this.store = store;
    this.loaded = store.all().thenAccept(all -> all.forEach(w -> warps.put(w.name(), w)));
  }

  /** Starts loading every warp from {@code store}. */
  public static WarpDirectory load(WarpStore store) {
    return new WarpDirectory(store);
  }

  /** Completes once every warp has loaded. */
  public CompletableFuture<Void> loaded() {
    return loaded;
  }

  /** The warp called {@code name}. */
  public Optional<Warp> find(PlaceName name) {
    return Optional.ofNullable(warps.get(name));
  }

  /** Every warp name, sorted. */
  public List<PlaceName> names() {
    return warps.keySet().stream().sorted().toList();
  }

  /** Creates or moves a warp. */
  public CompletableFuture<Void> set(Warp warp) {
    return loaded.thenCompose(
        ready -> {
          warps.put(warp.name(), warp);
          return store.save(warp);
        });
  }

  /** Deletes a warp; completes with false if it did not exist. */
  public CompletableFuture<Boolean> delete(PlaceName name) {
    return loaded.thenCompose(
        ready -> {
          warps.remove(name);
          return store.delete(name);
        });
  }
}
