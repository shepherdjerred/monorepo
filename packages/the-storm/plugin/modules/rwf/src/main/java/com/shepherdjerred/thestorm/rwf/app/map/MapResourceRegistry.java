package com.shepherdjerred.thestorm.rwf.app.map;

import com.shepherdjerred.thestorm.rwf.domain.map.MapDefinition;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;

/** Main-thread registry; handlers own their asynchronous work and retain only prepared maps. */
public final class MapResourceRegistry implements MapResources {
  private final List<Handler> handlers = new ArrayList<>();

  @Override
  public Subscription register(Handler handler) {
    if (handlers.contains(handler))
      throw new IllegalArgumentException("handler already registered");
    handlers.add(handler);
    return () -> handlers.remove(handler);
  }

  public CompletableFuture<Void> prepare(MapDefinition map) {
    var futures =
        handlers.stream()
            .map(handler -> handler.prepare(map.id()))
            .toArray(CompletableFuture<?>[]::new);
    return CompletableFuture.allOf(futures);
  }

  public void release(String mapId) {
    for (var handler : List.copyOf(handlers)) handler.release(mapId);
  }
}
