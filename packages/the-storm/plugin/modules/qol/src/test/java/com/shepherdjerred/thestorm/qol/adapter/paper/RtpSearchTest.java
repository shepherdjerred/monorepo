package com.shepherdjerred.thestorm.qol.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.qol.domain.QolConfig;
import com.shepherdjerred.thestorm.qol.domain.rtp.BlockPoint;
import java.lang.reflect.Proxy;
import java.time.Duration;
import java.util.List;
import java.util.Optional;
import java.util.Random;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicReference;
import org.bukkit.World;
import org.junit.jupiter.api.Test;

final class RtpSearchTest {

  @Test
  void failedChunkLoadCompletesTheSearch() {
    var failed = new IllegalStateException("chunk unavailable");
    var world =
        (World)
            Proxy.newProxyInstance(
                World.class.getClassLoader(),
                new Class<?>[] {World.class},
                (proxy, method, args) -> {
                  if (method.getName().equals("getChunkAtAsync")) {
                    return CompletableFuture.failedFuture(failed);
                  }
                  throw new AssertionError("Unexpected world call: " + method.getName());
                });
    var config =
        new QolConfig("PT1H", "PT1H", "PT0S", "PT1H", 25, 1, 0, 100, 0, 100, List.of("plains"));
    var search = new RtpSearch(config, new ImmediateScheduler());
    var origin = new BlockPoint(0, 0);
    var request =
        new RtpSearch.Request(
            new RtpSearch.Site(world, origin, origin, 1000),
            new RtpSearch.Target(Optional.empty(), List.of(), List.of()));
    var outcome = new AtomicReference<RtpSearch.Outcome>();

    search.find(request, new Random(1), outcome::set);

    assertThat(outcome.get()).isNotNull();
    assertThat(outcome.get().spot()).isEmpty();
    assertThat(outcome.get().failure()).hasCause(failed);
  }

  private static final class ImmediateScheduler implements Scheduler {
    @Override
    public void runOnMainThread(Runnable task) {
      task.run();
    }

    @Override
    public Cancellable runOnMainThreadLater(Duration delay, Runnable task) {
      throw new AssertionError("Unexpected delayed task");
    }

    @Override
    public Cancellable repeatOnMainThread(Duration delay, Duration period, Runnable task) {
      throw new AssertionError("Unexpected repeating task");
    }

    @Override
    public Executor mainThread() {
      return Runnable::run;
    }
  }
}
