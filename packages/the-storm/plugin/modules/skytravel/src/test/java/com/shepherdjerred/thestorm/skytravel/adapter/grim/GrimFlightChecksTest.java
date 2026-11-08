package com.shepherdjerred.thestorm.skytravel.adapter.grim;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import ac.grim.grimac.api.AbstractCheck;
import ac.grim.grimac.api.GrimUser;
import java.lang.reflect.Proxy;
import java.util.ArrayDeque;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class GrimFlightChecksTest {
  private final ArrayDeque<Runnable> tasks = new ArrayDeque<>();
  private final UUID player = UUID.randomUUID();

  @Test
  void restoresOnlyTheExactChecksItPausedIncludingDuplicateNames() {
    var enabled = new Check("Simulation", true);
    var disabled = new Check("Simulation", false);
    var combat = new Check("Reach", true);
    var checks = List.of(enabled.proxy(), disabled.proxy(), combat.proxy());
    var runtime = new GrimFlightChecks(_ -> user(checks));
    runtime.active(player, true);
    drain();
    assertThat(enabled.enabled).isFalse();
    assertThat(disabled.enabled).isFalse();
    assertThat(combat.enabled).isTrue();
    runtime.active(player, false);
    drain();
    assertThat(enabled.enabled).isTrue();
    assertThat(disabled.enabled).isFalse();
    assertThat(combat.enabled).isTrue();
  }

  @Test
  void aDelayedPauseCannotOutliveCancellationOrReplaceTheNextFlight() {
    var check = new Check("Phase", true);
    var runtime = new GrimFlightChecks(_ -> user(List.of(check.proxy())));
    runtime.active(player, true);
    runtime.active(player, false);
    drain();
    assertThat(check.enabled).isTrue();
    runtime.active(player, true);
    drain();
    assertThat(check.enabled).isFalse();
    runtime.active(player, false);
    runtime.active(player, true);
    drain();
    assertThat(check.enabled).isFalse();
    runtime.stop();
    drain();
    assertThat(check.enabled).isTrue();
  }

  @Test
  void missingGrimPlayerRefusesAssistance() {
    var runtime = new GrimFlightChecks(_ -> null);
    assertThatThrownBy(() -> runtime.active(player, true))
        .isInstanceOf(IllegalStateException.class);
  }

  private GrimUser user(List<AbstractCheck> checks) {
    return (GrimUser)
        Proxy.newProxyInstance(
            getClass().getClassLoader(),
            new Class<?>[] {GrimUser.class},
            (_, method, arguments) ->
                switch (method.getName()) {
                  case "getChecks" -> checks;
                  case "runSafely" -> {
                    tasks.add((Runnable) arguments[0]);
                    yield null;
                  }
                  default -> throw new UnsupportedOperationException(method.getName());
                });
  }

  private void drain() {
    while (!tasks.isEmpty()) tasks.removeFirst().run();
  }

  private static final class Check {
    private final String name;
    private boolean enabled;

    Check(String name, boolean enabled) {
      this.name = name;
      this.enabled = enabled;
    }

    AbstractCheck proxy() {
      return (AbstractCheck)
          Proxy.newProxyInstance(
              getClass().getClassLoader(),
              new Class<?>[] {AbstractCheck.class},
              (_, method, arguments) ->
                  switch (method.getName()) {
                    case "getCheckName" -> name;
                    case "getStableKey" -> null;
                    case "isEnabled" -> enabled;
                    case "setEnabled" -> {
                      enabled = (boolean) arguments[0];
                      yield null;
                    }
                    default -> throw new UnsupportedOperationException(method.getName());
                  });
    }
  }
}
