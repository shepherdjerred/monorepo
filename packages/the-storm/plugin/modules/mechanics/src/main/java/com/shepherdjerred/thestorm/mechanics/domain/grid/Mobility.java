package com.shepherdjerred.thestorm.mechanics.domain.grid;

/** How vanilla pistons treat a block. */
public enum Mobility {
  /** Pushed and pulled. */
  NORMAL,
  /** Broken when pushed (torches, flowers). */
  BREAK,
  /** Never moves (obsidian, bedrock). */
  BLOCK,
  /** Pushed but not pulled (glazed terracotta). */
  PUSH_ONLY,
  /** Pistons pass through it (moving pistons, some technical blocks). */
  IGNORE,
}
