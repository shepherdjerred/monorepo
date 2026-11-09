package com.shepherdjerred.thestorm.core.capture;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.junit.jupiter.api.Test;

final class CaptureInspectionTest {
  @Test
  void preparationKeepsTheModulesFutureAndExactPlayerAndReceipt() {
    var registry = new CaptureInspection();
    var player = UUID.randomUUID();
    var id = UUID.randomUUID();
    var written = new CompletableFuture<Void>();
    registry.registerPreparation(
        "mail-reward",
        (owner, receipt) -> {
          assertThat(owner).isEqualTo(player);
          assertThat(receipt).isEqualTo(id);
          return written;
        });
    assertThat(registry.prepare(player, "mail-reward", id)).isSameAs(written).isNotCompleted();
    written.complete(null);
    assertThat(registry.prepare(player, "mail-reward", id)).isCompleted();
    assertThatThrownBy(() -> registry.prepare(player, "unknown", id))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(
            () -> registry.registerPreparation("mail-reward", (owner, receipt) -> written))
        .isInstanceOf(IllegalStateException.class);
  }
}
