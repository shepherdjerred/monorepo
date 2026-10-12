package com.shepherdjerred.thestorm.rwfbots.domain.chat;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.personality.Lines;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

/** Which bot lines are team calls and which are banter for everyone. */
final class UtteranceTest {

  private static Utterance line(Lines.Moment moment, Optional<String> team) {
    return new Utterance(
        UUID.fromString("00000000-0000-0000-0000-0000000000b0"),
        "Bot",
        team,
        moment,
        "line",
        "line",
        Instant.EPOCH);
  }

  @ParameterizedTest
  @EnumSource(Lines.Moment.class)
  void plantsDefusesAndLastCallsStayWithTheTeam(Lines.Moment moment) {
    var call =
        moment == Lines.Moment.ON_PLANT
            || moment == Lines.Moment.ON_DEFUSE
            || moment == Lines.Moment.ON_LAST_ALIVE;

    assertThat(line(moment, Optional.of("Red Team")).teamOnly()).isEqualTo(call);
    assertThat(line(moment, Optional.empty()).teamOnly())
        .as("before teams exist every line is for everyone")
        .isFalse();
  }
}
