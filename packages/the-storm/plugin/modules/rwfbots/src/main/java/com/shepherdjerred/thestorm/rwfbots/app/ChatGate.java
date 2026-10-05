package com.shepherdjerred.thestorm.rwfbots.app;

import java.util.concurrent.CompletableFuture;

/**
 * The managed rollout gate for bot chat. Evaluated off the main thread; the chat adapter caches the
 * answer and treats a failure as closed.
 */
public interface ChatGate extends AutoCloseable {

  /** Whether bots may talk right now. */
  CompletableFuture<Boolean> enabled();

  @Override
  void close();

  /** A gate that is always closed, for a server without Flipt. */
  static ChatGate closed() {
    return new ChatGate() {
      @Override
      public CompletableFuture<Boolean> enabled() {
        return CompletableFuture.completedFuture(false);
      }

      @Override
      public void close() {}
    };
  }
}
