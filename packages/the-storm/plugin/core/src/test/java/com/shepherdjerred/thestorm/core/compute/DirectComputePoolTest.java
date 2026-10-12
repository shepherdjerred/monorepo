package com.shepherdjerred.thestorm.core.compute;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.concurrent.RejectedExecutionException;
import org.junit.jupiter.api.Test;

final class DirectComputePoolTest {

  @Test
  void runsWorkOnTheCallingThreadBeforeReturning() {
    var pool = new DirectComputePool();
    var worker = pool.submit(Thread::currentThread);
    assertThat(worker).isCompletedWithValue(Thread.currentThread());
  }

  @Test
  void closeIsIdempotentAndRejectsLaterWork() {
    var pool = new DirectComputePool();
    assertThat(pool.isClosed()).isFalse();
    pool.close();
    pool.close();
    assertThat(pool.isClosed()).isTrue();
    assertThatThrownBy(() -> pool.executor().execute(() -> {}))
        .isInstanceOf(RejectedExecutionException.class);
  }
}
