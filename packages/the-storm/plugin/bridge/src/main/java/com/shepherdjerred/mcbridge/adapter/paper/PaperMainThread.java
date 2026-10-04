package com.shepherdjerred.mcbridge.adapter.paper;

import com.shepherdjerred.mcbridge.app.MainThread;
import com.shepherdjerred.mcbridge.domain.BridgeException;
import com.shepherdjerred.mcbridge.domain.ErrorCode;
import java.time.Duration;
import java.util.Objects;
import java.util.concurrent.Callable;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.bukkit.plugin.Plugin;

/** {@link MainThread} on the Bukkit scheduler. */
public final class PaperMainThread implements MainThread {
  private final Plugin plugin;

  public PaperMainThread(Plugin plugin) {
    this.plugin = plugin;
  }

  @Override
  public <T> T call(Callable<T> task, Duration timeout) {
    return callAsync(() -> CompletableFuture.completedFuture(task.call()), timeout);
  }

  @Override
  public <T> T callAsync(Callable<CompletableFuture<T>> task, Duration timeout) {
    if (plugin.getServer().isPrimaryThread()) {
      throw new IllegalStateException("MainThread.call must not run on the main thread");
    }
    long deadline = System.nanoTime() + timeout.toNanos();
    CompletableFuture<CompletableFuture<T>> scheduled = new CompletableFuture<>();
    plugin
        .getServer()
        .getScheduler()
        .runTask(
            plugin,
            () -> {
              try {
                scheduled.complete(task.call());
              } catch (Exception e) {
                scheduled.completeExceptionally(e);
              }
            });
    CompletableFuture<T> inner = await(scheduled, deadline, timeout);
    return await(inner, deadline, timeout);
  }

  private static <T> T await(CompletableFuture<T> future, long deadline, Duration timeout) {
    try {
      return future.get(Math.max(0, deadline - System.nanoTime()), TimeUnit.NANOSECONDS);
    } catch (TimeoutException e) {
      throw new BridgeException(
          ErrorCode.TIMEOUT, "main-thread work did not finish within " + timeout, e);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new BridgeException(ErrorCode.INTERNAL, "interrupted waiting for the main thread", e);
    } catch (ExecutionException e) {
      Throwable cause = e.getCause();
      throw unwrap(cause == null ? e : cause);
    }
  }

  private static RuntimeException unwrap(Throwable cause) {
    Throwable current = cause;
    while (current instanceof CompletionException completion) {
      Throwable inner = completion.getCause();
      if (inner == null) {
        break;
      }
      current = inner;
    }
    if (current instanceof RuntimeException runtime) {
      return runtime;
    }
    return new BridgeException(
        ErrorCode.INTERNAL,
        Objects.requireNonNullElse(current.getMessage(), current.toString()),
        current);
  }
}
