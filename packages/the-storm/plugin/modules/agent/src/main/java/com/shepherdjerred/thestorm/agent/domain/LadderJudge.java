package com.shepherdjerred.thestorm.agent.domain;

/**
 * Turns a classification into a ladder rung. Clean lines, uncertain calls, and bookkeeping cases
 * pass; offenses without a ladder escalate, because an unwritten rule is a human decision, not a
 * free pass.
 */
public final class LadderJudge {

  private LadderJudge() {}

  /** Judges {@code input} against {@code ladders}. */
  public static JudgeOutcome judge(JudgeInput input, LadderTable ladders) {
    if (input.offense().isEmpty()) {
      return new JudgeOutcome.Allow("clean");
    }
    var offense = input.offense().orElseThrow();
    if (offense == Offense.OTHER) {
      return new JudgeOutcome.Allow("bookkeeping");
    }
    if (!(input.confidence() >= input.threshold())) {
      return new JudgeOutcome.Allow("below-threshold");
    }
    var ladder = ladders.ladder(offense);
    if (ladder.isEmpty()) {
      return new JudgeOutcome.Escalate("no-ladder");
    }
    var rung = Math.min(input.strikes(), ladder.orElseThrow().steps().size() - 1);
    return new JudgeOutcome.Act(ladder.orElseThrow().evaluate(input.strikes()), offense, rung);
  }
}
