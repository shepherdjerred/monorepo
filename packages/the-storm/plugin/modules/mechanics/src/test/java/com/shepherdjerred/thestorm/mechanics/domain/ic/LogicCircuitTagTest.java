package com.shepherdjerred.thestorm.mechanics.domain.ic;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

final class LogicCircuitTagTest {
  @Test
  void selfTriggerSuffixUsesTheOriginalOutsideBracketFormat() {
    assertThat(CircuitTag.parse("[MC1111]S"))
        .contains(new CircuitTag(CircuitTag.Kind.RECEIVER, true));
    assertThat(CircuitTag.parse("[MC1111S]")).isEmpty();
  }

  @Test
  void clocksAlwaysSelfTriggerButTransmittersHaveNoThinkCallback() {
    assertThat(CircuitTag.parse("[MC1421]")).contains(new CircuitTag(CircuitTag.Kind.CLOCK, true));
    assertThat(CircuitTag.parse("[MC1110]S"))
        .contains(new CircuitTag(CircuitTag.Kind.TRANSMITTER, false));
  }
}
