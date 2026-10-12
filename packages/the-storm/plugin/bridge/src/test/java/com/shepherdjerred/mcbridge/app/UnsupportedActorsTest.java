package com.shepherdjerred.mcbridge.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.mcbridge.domain.ActorName;
import com.shepherdjerred.mcbridge.domain.BlockPos;
import com.shepherdjerred.mcbridge.domain.BridgeException;
import com.shepherdjerred.mcbridge.domain.ErrorCode;
import org.junit.jupiter.api.Test;

final class UnsupportedActorsTest {
  private final UnsupportedActors actors = new UnsupportedActors();

  @Test
  void failsLoudlyWithoutCitizens() {
    assertThat(actors.supported()).isFalse();
    assertThatThrownBy(actors::list)
        .isInstanceOfSatisfying(
            BridgeException.class,
            error -> {
              assertThat(error.code()).isEqualTo(ErrorCode.UNSUPPORTED);
              assertThat(error.detail()).contains("Citizens is not installed");
            });
    assertThatThrownBy(() -> actors.look(new ActorName("alice"), new BlockPos(0, 0, 0)))
        .isInstanceOf(BridgeException.class);
  }
}
