package com.shepherdjerred.thestorm.rwfbots.domain.team;

/** The jobs a team hands out each round. */
public enum Role {
  /** Carry the fuse to an enemy bomb and arm it. */
  PLANT,
  /** Stay with the planter and clear the way. */
  ESCORT,
  /** Hold near the team's own bomb. */
  DEFEND,
  /** Move between sites as the fight shifts. */
  ROTATE,
  /** Take back and defuse an armed own bomb. */
  RETAKE,
  /** Find and kill enemies away from the bombs. */
  HUNT
}
