package com.shepherdjerred.thestorm.client;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class InputLeaseTest {
  @Test
  void heldMovementEndsAtItsTickBudget() {
    var lease = new InputLease();
    assertThat(lease.active()).isFalse();
    var result = lease.start(UUID.randomUUID(), Set.of("forward"), 2);
    assertThat(lease.active()).isTrue();
    lease.tick();
    assertThat(result).isNotDone();
    lease.tick();
    assertThat(result).isCompletedWithValue("Input completed");
    assertThat(lease.buttons()).isEmpty();
    assertThat(lease.active()).isFalse();
  }

  @Test
  void OnlyTheOwningDisconnectCancelsAnInput() {
    var lease = new InputLease();
    var owner = UUID.randomUUID();
    var result = lease.start(owner, Set.of("jump", "use"), 100);
    lease.disconnect(UUID.randomUUID());
    assertThat(result).isNotDone();
    lease.disconnect(owner);
    assertThat(result).isCompletedExceptionally();
    assertThat(lease.buttons()).isEmpty();
    assertThat(lease.start(UUID.randomUUID(), Set.of("back"), 1)).isNotDone();
  }

  @Test
  void RejectsOverlappingAndUnboundedInputs() {
    var lease = new InputLease();
    var owner = UUID.randomUUID();
    assertThatThrownBy(() -> lease.start(owner, Set.of("forward"), 101))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> lease.start(owner, Set.of("teleport"), 1))
        .isInstanceOf(IllegalArgumentException.class);
    var result = lease.start(owner, Set.of("forward"), 10);
    assertThatThrownBy(() -> lease.start(owner, Set.of("back"), 1))
        .isInstanceOf(IllegalStateException.class);
    lease.release();
    assertThat(result).isCompletedExceptionally();
  }
}
