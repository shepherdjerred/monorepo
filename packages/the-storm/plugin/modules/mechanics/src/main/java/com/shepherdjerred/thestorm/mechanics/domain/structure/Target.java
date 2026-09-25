package com.shepherdjerred.thestorm.mechanics.domain.structure;

/** What a use asks of a structure. */
public enum Target {
  /** Clear the passage: take the structure's blocks into its sign. Redstone power opens. */
  OPEN,
  /** Fill the passage from the sign's stock. Losing redstone power closes. */
  CLOSE,
  /** Open if any of it stands, otherwise close. A right-click toggles. */
  TOGGLE,
}
