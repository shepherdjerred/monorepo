package com.shepherdjerred.thestorm.rwf.adapter.db;

import java.util.concurrent.CompletableFuture;

/** Helpers shared by the repositories. */
final class Writes {

  private Writes() {}

  /** {@code write}, with its result dropped. */
  static CompletableFuture<Void> done(CompletableFuture<?> write) {
    return write.thenAccept(result -> {});
  }
}
