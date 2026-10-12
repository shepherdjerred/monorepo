package com.shepherdjerred.thestorm.rwf.app;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.domain.match.MatchError;
import java.util.EnumSet;
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

  @Test
  void rulesWithoutTheirOwnRefusalShareOne() {
    for (var error :
        EnumSet.of(MatchError.ALREADY_JOINED, MatchError.IN_PROGRESS, MatchError.FULL)) {
      assertThat(ActionRefusal.of(error)).isEqualTo(ActionRefusal.NOT_A_MEMBER);
    }
    assertThat(ActionRefusal.of(MatchError.KIT_LOCKED)).isEqualTo(ActionRefusal.KIT_LOCKED);
    assertThat(ActionRefusal.of(MatchError.NOT_RESETTING)).isEqualTo(ActionRefusal.NOT_LIVE);
  }
}
