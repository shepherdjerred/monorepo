package com.shepherdjerred.thestorm.discord.domain;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

final class BridgeTextTest {

  @Test
  void makesMentionsAndControlCharactersInert() {
    assertThat(BridgeText.clean("hi\n@everyone @here\u0000")).isEqualTo("hi @ everyone @ here");
  }

  @Test
  void boundsInboundContent() {
    assertThat(BridgeText.fromDiscord("Alex", "a".repeat(400)))
        .startsWith("[Discord] <Alex> ")
        .hasSizeLessThan(340);
  }
}
