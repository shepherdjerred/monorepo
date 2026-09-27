package com.shepherdjerred.thestorm.agent.domain;

/** What the deterministic pre-filters say about a chat line. */
public sealed interface PrefilterVerdict {

  /** Clean enough to skip the brain entirely. */
  record Allow() implements PrefilterVerdict {}

  /**
   * Ambiguous: ask the brain.
   *
   * @param signal why it is suspicious, for example {@code caps}
   */
  record Check(String signal) implements PrefilterVerdict {}

  /**
   * Obvious: act without asking the brain.
   *
   * @param offense what it is
   * @param signal why it fired, for example {@code rate}
   */
  record Act(Offense offense, String signal) implements PrefilterVerdict {}
}
