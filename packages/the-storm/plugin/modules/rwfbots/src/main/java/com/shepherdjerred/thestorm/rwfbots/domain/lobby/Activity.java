package com.shepherdjerred.thestorm.rwfbots.domain.lobby;

/** What a bot does to pass the time in the lobby, one at a time. */
public enum Activity {
  /** Walk to a random spot in the room. */
  WANDER,
  /** Walk up to someone (a human, a rival, a friend), stop a few blocks short and face them. */
  APPROACH,
  /** Walk to a kit alcove and look at the kit there. */
  BROWSE_KITS,
  /** Stand and glance about. */
  LOOK_AROUND,
  /** Tap sneak, the Minecraft hello, at someone close or at nobody. */
  SNEAK_TAP,
  /** Jump on the spot a few times. */
  JUMP,
  /** Stand with others at one side of the room. */
  HANG_OUT
}
