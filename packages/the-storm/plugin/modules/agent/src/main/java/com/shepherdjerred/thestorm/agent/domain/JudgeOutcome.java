package com.shepherdjerred.thestorm.agent.domain;

/** What the ladder says about a classification. Temporary bans still need a human to swing. */
public sealed interface JudgeOutcome {

  /**
   * No enforcement.
   *
   * @param detail why, for example {@code clean} or {@code below-threshold}
   */
  record Allow(String detail) implements JudgeOutcome {}

  /**
   * Enforce this rung.
   *
   * @param step the rung
   * @param offense what it answers
   * @param rung the rung index, first rung first
   */
  record Act(LadderStep step, Offense offense, int rung) implements JudgeOutcome {}

  /**
   * A human must decide.
   *
   * @param detail why, for example {@code no-ladder}
   */
  record Escalate(String detail) implements JudgeOutcome {}
}
