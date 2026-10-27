package com.shepherdjerred.thestorm.core.reset;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.junit.jupiter.api.Test;

final class PlayerResetRegistryTest {

  private static final UUID PLAYER = new UUID(0, 1);

  @Test
  void runsHandlersInRegistrationOrderIncludingCore() {
    var registry = new PlayerResetRegistry();
    var calls = new java.util.ArrayList<String>();
    registry.register("core", player -> completed(calls, "core"));
    registry.register("one", player -> completed(calls, "one"));
    registry.stateless("two");
    registry.complete(Set.of("one", "two"));

    assertThat(registry.reset(PLAYER)).succeedsWithin(java.time.Duration.ofSeconds(1));
    assertThat(calls).containsExactly("core", "one");
  }

  @Test
  void rejectsMissingAndUnexpectedDeclarations() {
    var registry = new PlayerResetRegistry();
    registry.register("core", player -> completed(new java.util.ArrayList<>(), "core"));
    registry.stateless("extra");

    assertThatThrownBy(() -> registry.complete(Set.of("needed")))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("missing=[needed]")
        .hasMessageContaining("unexpected=[extra]");
  }

  @Test
  void rejectsDuplicateParticipation() {
    var registry = new PlayerResetRegistry();
    registry.stateless("one");

    assertThatThrownBy(() -> registry.stateless("one"))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("Duplicate");
  }

  @Test
  void cannotResetBeforeTheInventoryIsComplete() {
    var registry = new PlayerResetRegistry();

    assertThatThrownBy(() -> registry.reset(PLAYER))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("not complete");
  }

  private static CompletableFuture<Void> completed(List<String> calls, String module) {
    calls.add(module);
    return CompletableFuture.completedFuture(module).thenAccept(ignored -> {});
  }
}
