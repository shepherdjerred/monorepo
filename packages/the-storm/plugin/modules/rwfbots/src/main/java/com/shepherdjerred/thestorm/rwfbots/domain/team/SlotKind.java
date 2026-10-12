package com.shepherdjerred.thestorm.rwfbots.domain.team;

/** The kinds of position a {@link Playbook} hands out, each with the role its holder plays. */
public enum SlotKind {
  /** Carry the fuse to the round's objective and arm it. */
  PLANT(Role.PLANT),
  /** A wedge point a few blocks behind and beside the planter. */
  ESCORT(Role.ESCORT),
  /** A point along one of the approach lanes, a little ahead of the planter. */
  LANE(Role.ROTATE),
  /** A wide point off the outermost lane, where little of the enemy's ground can see it. */
  FLANK(Role.ROTATE),
  /** Cover with a long sightline onto the objective. */
  OVERWATCH(Role.ROTATE),
  /** Cover near the team's own bomb facing an approach nobody else watches. */
  ANCHOR(Role.DEFEND),
  /** Where the enemy was last seen or is likely to be, walked in pairs. */
  SWEEP(Role.HUNT);

  private final Role role;

  SlotKind(Role role) {
    this.role = role;
  }

  /** The role a bot holding this kind of slot plays. */
  public Role role() {
    return role;
  }
}
