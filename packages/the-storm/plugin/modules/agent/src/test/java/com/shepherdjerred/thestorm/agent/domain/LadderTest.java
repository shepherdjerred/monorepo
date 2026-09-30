package com.shepherdjerred.thestorm.agent.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.Test;

final class LadderTest {

  private static Ladder ladder() {
    return new Ladder(
        Offense.SPAM,
        "7d",
        List.of(
            new LadderStep(LadderAction.MUTE, "10m"),
            new LadderStep(LadderAction.MUTE, "1h"),
            new LadderStep(LadderAction.ESCALATE, "none")));
  }

  @Test
  void strikesClimbOneRungEach() {
    var ladder = ladder();

    assertThat(ladder.evaluate(0).length()).contains(Duration.ofMinutes(10));
    assertThat(ladder.evaluate(1).length()).contains(Duration.ofHours(1));
    assertThat(ladder.evaluate(2).action()).isEqualTo(LadderAction.ESCALATE);
  }

  @Test
  void strikesPastTheTopRepeatTheTop() {
    assertThat(ladder().evaluate(99).action()).isEqualTo(LadderAction.ESCALATE);
  }

  @Test
  void windowParses() {
    assertThat(ladder().window()).isEqualTo(Duration.ofDays(7));
  }

  @Test
  void stepsWithoutRungsAndBadDurationsAreRejected() {
    assertThatThrownBy(() -> new Ladder(Offense.SPAM, "7d", List.of()))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(
            () ->
                new Ladder(Offense.SPAM, "7d", List.of(new LadderStep(LadderAction.MUTE, "none"))))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(
            () -> new Ladder(Offense.SPAM, "7d", List.of(new LadderStep(LadderAction.WARN, "10m"))))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(
            () ->
                new Ladder(
                    Offense.SPAM, "soon", List.of(new LadderStep(LadderAction.WARN, "none"))))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void tablesRejectDuplicatesAndMissQuietly() {
    var table = new LadderTable(List.of(ladder()));

    assertThat(table.ladder(Offense.SPAM)).contains(ladder());
    assertThat(table.ladder(Offense.GRIEF)).isEmpty();
    assertThatThrownBy(() -> new LadderTable(List.of(ladder(), ladder())))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void idsRoundTrip() {
    for (var offense : Offense.values()) {
      assertThat(Offense.fromId(offense.id())).isEqualTo(offense);
    }
    for (var action : LadderAction.values()) {
      assertThat(LadderAction.fromId(action.id())).isEqualTo(action);
    }
    assertThatThrownBy(() -> Offense.fromId("nope")).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> LadderAction.fromId("ban"))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
