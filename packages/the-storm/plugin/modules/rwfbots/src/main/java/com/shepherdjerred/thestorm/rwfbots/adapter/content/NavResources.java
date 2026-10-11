package com.shepherdjerred.thestorm.rwfbots.adapter.content;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.rwf.app.map.MapResources;
import com.shepherdjerred.thestorm.rwfbots.app.NavCatalog;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.CompletableFuture;

/**
 * Navigation follows prepared terrain lifetimes; reading and validation run off the main thread.
 */
public final class NavResources implements MapResources.Handler, AutoCloseable {
  private final ModuleContext context;
  private final NavCatalog nav;
  private final Map<String, Long> active = new HashMap<>();
  private final MapResources.Subscription subscription;
  private boolean closed;
  private long request;

  public NavResources(ModuleContext context, NavCatalog nav) {
    this.context = context;
    this.nav = nav;
    subscription = context.services().require(MapResources.class).register(this);
  }

  @Override
  public CompletableFuture<Void> prepare(String mapId) {
    if (closed || active.containsKey(mapId))
      throw new IllegalStateException("Navigation is closed or already prepared for " + mapId);
    var token = ++request;
    active.put(mapId, token);
    var file =
        context
            .dataDirectory()
            .resolve(NavFiles.MAPS_DIRECTORY)
            .resolve(mapId)
            .resolve(NavFiles.FILE_NAME);
    return context
        .compute()
        .submit(() -> NavFiles.read(file, mapId))
        .thenAcceptAsync(
            result -> {
              if (!Objects.equals(active.get(mapId), token)) return;
              switch (result) {
                case Result.Ok<NavArtifact, String>(var artifact) -> nav.add(artifact);
                case Result.Err<NavArtifact, String>(var problem) -> {
                  nav.reject(mapId, problem);
                  context.logger().error("rwfbots: map {} runs humans-only: {}", mapId, problem);
                }
              }
            },
            context.scheduler().mainThread());
  }

  @Override
  public void release(String mapId) {
    active.remove(mapId);
    nav.evict(mapId);
  }

  @Override
  public void close() {
    closed = true;
    subscription.close();
    for (var mapId : Set.copyOf(active.keySet())) release(mapId);
  }
}
