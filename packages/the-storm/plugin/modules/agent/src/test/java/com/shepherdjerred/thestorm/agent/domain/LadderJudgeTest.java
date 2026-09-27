package com.shepherdjerred.thestorm.agent.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

final class LadderJudgeTest {

  private static final Ladder SPAM =
      new Ladder(
          Offense.SPAM,
          "7d",
          List.of(
              new LadderStep(LadderAction.WARN, LadderStep.NONE),
              new LadderStep(LadderAction.MUTE, "10m")));
  private static final LadderTable LADDERS = new LadderTable(List.of(SPAM));

  private static JudgeInput input(Optional<Offense> offense, double confidence, int strikes) {
    return new JudgeInput(offense, confidence, 0.8, strikes);
  }

  @Test
  void cleanUncertainAndBookkeepingPass() {
    assertThat(LadderJudge.judge(input(Optional.empty(), 0, 0), LADDERS))
        .isEqualTo(new JudgeOutcome.Allow("clean"));
    assertThat(LadderJudge.judge(input(Optional.of(Offense.SPAM), 0.5, 0), LADDERS))
        .isEqualTo(new JudgeOutcome.Allow("below-threshold"));
    assertThat(LadderJudge.judge(input(Optional.of(Offense.OTHER), 1, 0), LADDERS))
        .isEqualTo(new JudgeOutcome.Allow("bookkeeping"));
  }

  @Test
  void theThresholdIsInclusive() {
    assertThat(LadderJudge.judge(input(Optional.of(Offense.SPAM), 0.8, 0), LADDERS))
        .isEqualTo(
            new JudgeOutcome.Act(
                new LadderStep(LadderAction.WARN, LadderStep.NONE), Offense.SPAM, 0));
  }

  @Test
  void strikesClimbAndTopOut() {
    assertThat(LadderJudge.judge(input(Optional.of(Offense.SPAM), 0.9, 1), LADDERS))
        .isEqualTo(new JudgeOutcome.Act(new LadderStep(LadderAction.MUTE, "10m"), Offense.SPAM, 1));
    assertThat(LadderJudge.judge(input(Optional.of(Offense.SPAM), 0.9, 9), LADDERS))
        .isEqualTo(new JudgeOutcome.Act(new LadderStep(LadderAction.MUTE, "10m"), Offense.SPAM, 1));
  }

  @Test
  void missingLaddersEscalate() {
    assertThat(LadderJudge.judge(input(Optional.of(Offense.GRIEF), 0.9, 0), LADDERS))
        .isEqualTo(new JudgeOutcome.Escalate("no-ladder"));
  }
}
