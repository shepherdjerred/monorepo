package com.shepherdjerred.thestorm.core.module;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

final class ServicesTest {

  private interface Greeter {
    String greet();
  }

  @Test
  void returnsTheProvidedService() {
    var services = new Services();
    Greeter greeter = () -> "Welcome to The Storm";
    services.provide(Greeter.class, greeter);

    assertThat(services.require(Greeter.class).greet()).isEqualTo("Welcome to The Storm");
  }

  @Test
  void missingServiceFailsLoudly() {
    assertThatThrownBy(() -> new Services().require(Greeter.class))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("is not provided");
  }

  @Test
  void secondProviderIsRejected() {
    var services = new Services();
    services.provide(Greeter.class, () -> "a");

    assertThatThrownBy(() -> services.provide(Greeter.class, () -> "b"))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("already provided");
  }
}
