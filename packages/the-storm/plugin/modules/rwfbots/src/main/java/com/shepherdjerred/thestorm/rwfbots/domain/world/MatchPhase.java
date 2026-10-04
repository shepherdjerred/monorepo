package com.shepherdjerred.thestorm.rwfbots.domain.world;

/** Where the match is. */
public enum MatchPhase {
  /** Players gather; nobody can move or fight. */
  WAITING,
  /** The match has started but damage is off for a few seconds. */
  GRACE,
  /** Fighting. */
  LIVE,
  /** A team won or the match was stopped. */
  OVER
}
