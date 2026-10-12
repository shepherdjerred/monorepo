package com.shepherdjerred.mcbridge.domain;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class BearerAuthTest {
  private final BearerAuth auth = new BearerAuth("secret-token");

  @Test
  void acceptsOnlyTheExactBearerHeader() {
    assertThat(auth.accepts("Bearer secret-token")).isTrue();
    assertThat(auth.accepts("Bearer secret-token2")).isFalse();
    assertThat(auth.accepts("Bearer secret")).isFalse();
    assertThat(auth.accepts("bearer secret-token")).isFalse();
    assertThat(auth.accepts("secret-token")).isFalse();
    assertThat(auth.accepts(null)).isFalse();
  }
}
