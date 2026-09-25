package com.shepherdjerred.thestorm.shops.app;

import java.util.concurrent.CompletableFuture;
import org.slf4j.Logger;

/** Storage writes nobody waits for. A failure is logged, never dropped. */
public final class Background {

  private Background() {}

  /** Logs {@code future}'s failure, if it fails, as "Could not {@code what}". */
  public static void logFailure(CompletableFuture<?> future, Logger logger, String what) {
    var _ =
        future.whenComplete(
            (value, error) -> {
              if (error != null) {
                logger.error("Could not {}", what, error);
              }
            });
  }
}
