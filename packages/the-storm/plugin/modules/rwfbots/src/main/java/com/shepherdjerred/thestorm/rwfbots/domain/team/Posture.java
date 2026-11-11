package com.shepherdjerred.thestorm.rwfbots.domain.team;

/**
 * How a team plays a match that is no longer two-sided. Empty on the plan means {@link #PRESS},
 * which is what a two-team match always does.
 */
public enum Posture {
  /** Stay out of a fight that is already two other teams, and take the winner. */
  WAIT,
  /** Prefer the unique smallest other team: their bomb, and them when they are known. */
  HUNT_WEAKEST,
  /** Play the round as a two-team fight: rush, split, or hunt whoever is nearest. */
  PRESS
}
