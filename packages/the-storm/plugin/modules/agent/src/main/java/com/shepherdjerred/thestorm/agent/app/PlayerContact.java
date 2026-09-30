package com.shepherdjerred.thestorm.agent.app;

import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * Reaching a player in-game. Implemented on the main thread; flows call it from wherever they run
 * and get the answer back.
 */
public interface PlayerContact {

  /**
   * Tells {@code player} {@code text}. Completes {@code false} when they are offline; never throws
   * for that.
   */
  CompletableFuture<Boolean> tell(UUID player, String text);

  /**
   * Kicks {@code player} with {@code reason}. Completes {@code false} when they are offline; never
   * throws for that.
   */
  CompletableFuture<Boolean> kick(UUID player, String reason);
}
