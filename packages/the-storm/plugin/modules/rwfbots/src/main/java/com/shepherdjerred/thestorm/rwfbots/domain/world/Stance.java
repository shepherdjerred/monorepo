package com.shepherdjerred.thestorm.rwfbots.domain.world;

/** How the body should carry itself while following a decision. */
public enum Stance {
  /** Sprint, close distance, fight anything seen. */
  AGGRESSIVE,
  /** Walk, keep spacing, fight only what engages. */
  CAUTIOUS,
  /** Sneak where exposed, avoid fights, prefer unseen routes. */
  STEALTH,
  /** Break contact: sprint away, no attacks. */
  EVASIVE
}
