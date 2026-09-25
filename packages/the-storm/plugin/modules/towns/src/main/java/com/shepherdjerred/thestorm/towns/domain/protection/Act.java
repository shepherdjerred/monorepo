package com.shepherdjerred.thestorm.towns.domain.protection;

/**
 * One thing a player tries to do: an action on a subject.
 *
 * @param action what they do
 * @param subject what they do it to
 */
public record Act(Action action, Subject subject) {

  public Act {
    if (subject == Subject.ANY) {
      throw new IllegalArgumentException("ANY is a region allowance wildcard, not a subject");
    }
  }
}
