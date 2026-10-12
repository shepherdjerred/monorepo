package com.shepherdjerred.thestorm.arena.domain.survival;

/** The gathered-material catalog is deliberately small enough to fit the team supplies menu. */
public enum ResourceKind {
  OAK_PLANKS("OAK_LOG"),
  COBBLESTONE("MOSSY_COBBLESTONE"),
  WHEAT("HAY_BLOCK"),
  IRON_INGOT("IRON_ORE"),
  FLINT("GRAVEL"),
  REDSTONE("REDSTONE_ORE"),
  BONE("BONE_BLOCK"),
  GLOWSTONE_DUST("GLOWSTONE"),
  COPPER_INGOT("RAW_COPPER_BLOCK"),
  STRING("WHITE_WOOL"),
  NETHER_WART("NETHER_WART_BLOCK"),
  BLAZE_POWDER("SHROOMLIGHT");

  private final String fixture;

  ResourceKind(String fixture) {
    this.fixture = fixture;
  }

  public String fixture() {
    return fixture;
  }
}
