package com.shepherdjerred.thestorm.arena.domain.survival;

/** Rune shrines offer conditional boons rather than permanent stat multipliers. */
public enum SurvivalPerk {
  STONEWARD(
      24,
      "Stoneward",
      "Blocking grants 4 absorption HP for four seconds; ten-second recharge.",
      "RELIC"),
  GALESTRIDE(
      20,
      "Galestride",
      "Sprint eight blocks to empower your next hit with knockback and a speed burst; eight-second recharge.",
      "OTHERSIDE"),
  EMBERWEAVE(
      32,
      "Emberweave",
      "Alternate melee and ranged hits within four seconds for a cinder burst; six-second recharge.",
      "PIGSTEP"),
  SOULBOND(
      16,
      "Soulbond",
      "Healing or reviving shares 2 HP with a nearby ally, or grants absorption when solo; ten-second recharge.",
      "CREATOR_MUSIC_BOX");
  private final int price;
  private final String title;
  private final String description;
  private final String disc;

  SurvivalPerk(int price, String title, String description, String disc) {
    this.price = price;
    this.title = title;
    this.description = description;
    this.disc = disc;
  }

  public int price() {
    return price;
  }

  public String title() {
    return title;
  }

  public String description() {
    return description;
  }

  public String disc() {
    return disc;
  }
}
