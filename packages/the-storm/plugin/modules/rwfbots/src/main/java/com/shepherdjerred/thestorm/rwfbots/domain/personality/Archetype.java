package com.shepherdjerred.thestorm.rwfbots.domain.personality;

/**
 * The kind of player a personality is, at a glance. The content generator derives the play knobs
 * from it (style, role and kit weights, lever offsets), and the bots also read it at runtime: the
 * team step fits archetypes to playbook slots ({@code team.SlotFit}), the think step bends its
 * utilities, decision temperature and fighting range by it ({@code tactics.ArchetypeBias}), and the
 * director adds {@link #aggressionZ()} to the personality's aggression lever offset. Skill still
 * sets how well a bot plays; the archetype sets what it tries to do.
 */
public enum Archetype {
  /** First into every fight; plants on the way through. Front lanes. */
  RUSHER(1.0),
  /** Drifts off the map alone and waits for footsteps. Late flanks. */
  LURKER(-0.2),
  /** Bow main; keeps range and holds long sightlines. Overwatch, 15 to 30 blocks. */
  SNIPER(-0.4),
  /** Beelines to the enemy bomb and arms it, fights optional. The plant slot. */
  BOMB_DIVER(0.3),
  /** Holds the team's own bomb and makes every push pay. Anchors. */
  ANCHOR(-0.6),
  /** Rotates wide and arrives from the side nobody watched. Flanks. */
  FLANKER(0.2),
  /** Stacks fuses, escorts the planter and shares every sighting. Escorts and help-arming. */
  SUPPORT(-0.3),
  /** Lives for the one-on-one; clicks fast and strafes clean. Engages. */
  DUELIST(0.8),
  /** Chases the last place an enemy was seen. Sweeps and last-known positions. */
  HUNTER(0.6),
  /** Digs in, never overextends, waits out the round. Anchors; eats a golden apple early. */
  TURTLE(-0.9),
  /** Erratic and theatrical; the plan is a suggestion. Hot decisions, random slots. */
  TROLL(0.4),
  /** Team first: calls, rotates and fills whatever is missing. Cool, strict playbook. */
  TACTICIAN(0.0);

  private final double aggressionZ;

  Archetype(double aggressionZ) {
    this.aggressionZ = aggressionZ;
  }

  /** The archetype's push on the aggression lever, as a z-score added to the personality's. */
  public double aggressionZ() {
    return aggressionZ;
  }
}
