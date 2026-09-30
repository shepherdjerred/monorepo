package com.shepherdjerred.thestorm.agent.adapter.paper;

import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;

/**
 * What the Paper adapters share: the main-thread scheduler, the logger, and the server id shown in
 * command output.
 *
 * @param scheduler main-thread scheduling
 * @param logger the module logger
 * @param serverId the server id shown in command output
 */
public record AgentRuntime(Scheduler scheduler, ComponentLogger logger, String serverId) {

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

  /** Logs a failed background task. */
  private void report(String what, Throwable failure) {
    logger.error(Component.text("agent: " + what + " failed"), failure);
  }
}
