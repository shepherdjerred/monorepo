package com.shepherdjerred.thestorm.rwf.app;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

final class SealedParticipantsTest {

  @Test
  void anotherSealedWorldCannotJoinQueueOrBePulled() {
    assertThat(SealedParticipants.blocked(true, false)).isTrue();
    assertThat(SealedParticipants.blocked(true, true)).isFalse();
    assertThat(SealedParticipants.blocked(false, false)).isFalse();
    assertThat(SealedParticipants.blocked(false, true)).isFalse();
  }
}
