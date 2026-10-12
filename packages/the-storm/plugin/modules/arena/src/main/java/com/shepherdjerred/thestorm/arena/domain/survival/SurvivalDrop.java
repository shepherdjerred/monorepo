package com.shepherdjerred.thestorm.arena.domain.survival;

/** Field salvage rewards positioning and existing Minecraft systems without clearing a wave. */
public enum SurvivalDrop {
  WILDGROWTH("Wildgrowth", "MOSS_BLOCK", "Stand in the eight-second grove to recover health."),
  REDSTONE_SURGE("Redstone Surge", "REDSTONE", "Your next three attacks arc to nearby foes."),
  RESONANT_SHARD(
      "Resonant Shard",
      "AMETHYST_SHARD",
      "Halves remaining ability recharge; empowers your next ability for fifteen seconds."),
  COPPER_PULSE(
      "Copper Pulse", "COPPER_INGOT", "Damages nearby enemies and staggers ordinary foes."),
  MASONS_ECHO("Mason's Echo", "BRICKS", "Gradually restores nearby barricades and charges traps.");
  private final String title;
  private final String material;
  private final String description;

  SurvivalDrop(String title, String material, String description) {
    this.title = title;
    this.material = material;
    this.description = description;
  }

  public String title() {
    return title;
  }

  public String material() {
    return material;
  }

  public String description() {
    return description;
  }
}
