package com.shepherdjerred.thestorm.rwfbots.domain.personality;

/**
 * The kind of player a personality is, at a glance. The archetype is what the content generator
 * derives the play knobs from (style, role and kit weights, lever offsets); at runtime the tactics
 * read those knobs, never the archetype itself.
 */
public enum Archetype {
  /** First into every fight; plants on the way through. */
  RUSHER,
  /** Drifts off the map alone and waits for footsteps. */
  LURKER,
  /** Bow main; keeps range and holds long sightlines. */
  SNIPER,
  /** Beelines to the enemy bomb and arms it, fights optional. */
  BOMB_DIVER,
  /** Holds the team's own bomb and makes every push pay. */
  ANCHOR,
  /** Rotates wide and arrives from the side nobody watched. */
  FLANKER,
  /** Stacks fuses, escorts the planter and shares every sighting. */
  SUPPORT,
  /** Lives for the one-on-one; clicks fast and strafes clean. */
  DUELIST,
  /** Chases the last place an enemy was seen. */
  HUNTER,
  /** Digs in, never overextends, waits out the round. */
  TURTLE,
  /** Erratic and theatrical; the plan is a suggestion. */
  TROLL,
  /** Team first: calls, rotates and fills whatever is missing. */
  TACTICIAN
}
