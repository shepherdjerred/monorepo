package com.shepherdjerred.thestorm.rwf.app;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.domain.match.MatchError;
import org.junit.jupiter.api.Test;

final class ActionRefusalTest {

  @Test
  void everyMatchRuleHasARefusal() {
    for (var error : MatchError.values()) {
      assertThat(ActionRefusal.of(error)).as(error.name()).isNotNull();
    }
    assertThat(ActionRefusal.of(MatchError.FULL)).isEqualTo(ActionRefusal.NOT_A_MEMBER);
    assertThat(ActionRefusal.of(MatchError.VOTE_CLOSED)).isEqualTo(ActionRefusal.NOT_PRE_GAME);
    assertThat(ActionRefusal.of(MatchError.UNKNOWN_BOMB)).isEqualTo(ActionRefusal.UNKNOWN_BOMB);
  }
}
