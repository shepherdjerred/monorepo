package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import java.time.InstantSource;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import org.bukkit.Server;

/**
 * What the qol adapters share: the server, the main-thread scheduler, the clock and the logger.
 *
 * @param server the server
 * @param scheduler main-thread scheduling
 * @param time the clock
 * @param logger the module logger
 */
record QolRuntime(Server server, Scheduler scheduler, InstantSource time, ComponentLogger logger) {

  /**
   * Runs {@code then} on the main thread with the result of {@code future}. If the future fails, or
   * {@code then} throws, the failure is logged and handed to {@code failed} on the main thread.
   */
  <T> void onMain(
      CompletableFuture<T> future, String what, Consumer<T> then, Consumer<Throwable> failed) {
    var _ =
        future.whenCompleteAsync(
            (value, failure) -> {
              if (failure != null) {
                report(what, failure);
                failed.accept(failure);
                return;
              }
              try {
                then.accept(value);
              } catch (RuntimeException e) {
                report(what, e);
                failed.accept(e);
              }
            },
            scheduler.mainThread());
  }

  /** Logs a failed task. */
  void report(String what, Throwable failure) {
    logger.error(Component.text("qol: " + what + " failed"), failure);
  }
}
