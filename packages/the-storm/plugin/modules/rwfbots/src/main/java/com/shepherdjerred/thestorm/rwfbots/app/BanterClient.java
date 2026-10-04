package com.shepherdjerred.thestorm.rwfbots.app;

import java.util.Optional;
import java.util.concurrent.CompletableFuture;

/**
 * Where a bot's chat lines come from. The only implementation today says nothing; a remote client
 * that turns a personality's tone and catchphrases into lines plugs in here without touching the
 * think loop.
 */
public interface BanterClient {

  /**
   * A line for {@code personalityId} reacting to {@code event} (such as {@code kill} or {@code
   * planted}), or empty to stay quiet.
   */
  CompletableFuture<Optional<String>> line(String personalityId, String event);

  /** A client whose bots never speak. */
  static BanterClient silent() {
    return (personalityId, event) -> CompletableFuture.completedFuture(Optional.empty());
  }
}
