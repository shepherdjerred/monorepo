package com.shepherdjerred.thestorm.discord.adapter.discord;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

final class JdaBridgeTest {
  @Test
  void townPageRegistrationBoundsTheListenersIntegerConversion() {
    var option = JdaBridge.townPageOption().toData();
    assertThat(option.getLong("min_value")).isEqualTo(1);
    assertThat(option.getLong("max_value")).isEqualTo(Integer.MAX_VALUE);
  }
}
