package com.shepherdjerred.thestorm.rwfbots.domain.team;

/** A team's plan for the round, chosen before it starts; {@link Playbook} turns it into slots. */
public enum Strategy {
  /** The planter up the middle with an escort wedge, the side lanes and flanks screening. */
  RUSH,
  /** Two groups on different lanes: the planter's and a pair with a flank. */
  SPLIT,
  /** Anchors over distinct approaches to the own bomb; one planter goes round the far lane. */
  TURTLE,
  /** Sweeping pairs look for kills first; a planter takes the nuke when it can. */
  HUNT
}
