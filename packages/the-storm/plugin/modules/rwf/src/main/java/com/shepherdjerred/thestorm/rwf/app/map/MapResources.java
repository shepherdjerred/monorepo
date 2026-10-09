package com.shepherdjerred.thestorm.rwf.app.map;

import java.util.concurrent.CompletableFuture;

/** Prepared-map resource lifetimes, shared with optional consumers such as bot navigation. */
public interface MapResources {
  interface Subscription extends AutoCloseable {
    @Override
    void close();
  }

  interface Handler {
    CompletableFuture<Void> prepare(String mapId);

    void release(String mapId);
  }

  Subscription register(Handler handler);
}
