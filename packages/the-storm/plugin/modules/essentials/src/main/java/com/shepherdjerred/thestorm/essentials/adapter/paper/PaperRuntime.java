package com.shepherdjerred.thestorm.essentials.adapter.paper;

import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import java.time.InstantSource;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.function.Consumer;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import org.bukkit.Server;

/**
 * What the Paper adapters share: the server, the main-thread scheduler, the clock and the logger.
 *
 * @param server the server
 * @param scheduler main-thread scheduling
 * @param time the clock
 * @param logger the module logger
 */
public record PaperRuntime(
    Server server, Scheduler scheduler, InstantSource time, ComponentLogger logger) {

  /** Runs {@code then} on the main thread with the result of {@code future}, logging failures. */
  <T> void onMain(CompletableFuture<T> future, String what, Consumer<T> then) {
    var _ =
        future.whenCompleteAsync(
            (value, failure) -> {
              if (failure != null) {
                report(what, failure);
                return;
              }
              then.accept(value);
            },
            main());
  }

  /** Logs {@code future}'s failure, if any. For writes nobody waits on. */
  void logFailure(CompletableFuture<?> future, String what) {
    var _ =
        future.whenComplete(
            (value, failure) -> {
              if (failure != null) {
                report(what, failure);
              }
            });
  }

  /** Logs a failed background task. */
  void report(String what, Throwable failure) {
    logger.error(Component.text("essentials: " + what + " failed"), failure);
  }

  /** The main thread, as an executor. */
  Executor main() {
    return scheduler.mainThread();
  }
}
