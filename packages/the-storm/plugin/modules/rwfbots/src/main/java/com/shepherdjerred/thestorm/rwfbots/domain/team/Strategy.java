package com.shepherdjerred.thestorm.rwfbots.domain.team;

import java.util.ArrayList;
import java.util.List;

/** A team's plan for the round, chosen before it starts. */
public enum Strategy {
  /** Everyone goes to plant together. */
  RUSH,
  /** A planting group and a defending group. */
  SPLIT,
  /** Hold the bomb; one planter looks for an opening. */
  TURTLE,
  /** Look for kills first, plant when the enemy is thin. */
  HUNT;

  /** The roles to hand out for a team of {@code size}, most important first. */
  public List<Role> slots(int size) {
    if (size < 1) {
      throw new IllegalArgumentException("a team has at least one player");
    }
    var slots = new ArrayList<Role>(size);
    slots.add(Role.PLANT);
    while (slots.size() < size) {
      slots.add(nth(slots.size()));
    }
    return slots;
  }

  private Role nth(int index) {
    return switch (this) {
      case RUSH -> Role.ESCORT;
      case SPLIT -> index % 2 == 1 ? Role.DEFEND : index % 4 == 2 ? Role.ESCORT : Role.ROTATE;
      case TURTLE -> index == 1 ? Role.RETAKE : Role.DEFEND;
      case HUNT -> index % 3 == 0 ? Role.ROTATE : Role.HUNT;
    };
  }
}
