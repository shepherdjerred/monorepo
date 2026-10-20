package com.shepherdjerred.thestorm.mail.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

final class MailCommandsTest {

  @Test
  void mailStaysInTheMailboxInsideASealedWorld() {
    assertThat(MailCommands.withholds(true)).isTrue();
    assertThat(MailCommands.withholds(false)).isFalse();
  }
}
