package com.shepherdjerred.thestorm.rwfbots.domain.personality;

/**
 * A small, named habit a personality has, from a fixed vocabulary so code can act on it. Three show
 * in play: {@link #CROUCH_SPAM} taps sneak when idle or after a kill (the reflex layer), {@link
 * #LATE_TO_EVERYTHING} stands a few seconds at the start of the match (the think step), and {@link
 * #LOVES_NUKE} pulls the bot towards the slot that arms the nuke (the team step). The rest are for
 * chat and stay content in play.
 */
public enum Quirk {
  /** Says gg after every match, win or lose. */
  ALWAYS_GG,
  /** Crouches repeatedly when idle or after a kill. */
  CROUCH_SPAM,
  /** Never eats a golden apple, whatever its health. */
  NEVER_EATS,
  /** Saves golden apples far longer than it should. */
  GAPPLE_HOARDER,
  /** Fixated on arming the enemy nuke. */
  LOVES_NUKE,
  /** Arrives a beat after everyone else. */
  LATE_TO_EVERYTHING,
  /** Calls out every sighting, real or imagined. */
  CALLS_EVERYTHING,
  /** Apologises for things that were not its fault. */
  SAYS_SORRY,
  /** Blames lag for every death. */
  BLAMES_LAG,
  /** Remembers who killed it last and goes looking for them. */
  HOLDS_GRUDGES,
  /** Celebrates before the round is actually won. */
  CELEBRATES_EARLY,
  /** Jumps constantly, crit or not. */
  BUNNY_HOPS,
  /** Fires arrows at anything that moves. */
  BOW_SPAMMER,
  /** Stands still a moment at round start, as if tabbed out. */
  SLOW_STARTER,
  /** Narrates the match in the third person. */
  NARRATES,
  /** Compliments the enemy's plays. */
  GOOD_SPORT,
  /** Stares at whoever killed it while spectating. */
  STARES_DOWN,
  /** Spins the camera when it thinks nobody is looking. */
  SPINS
}
