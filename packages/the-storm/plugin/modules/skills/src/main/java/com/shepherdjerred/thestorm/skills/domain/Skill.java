package com.shepherdjerred.thestorm.skills.domain;

/** The eleven permanent skills in the launch progression set. */
public enum Skill {
  MINING,
  WOODCUTTING,
  EXCAVATION,
  HERBALISM,
  FISHING,
  SWORDS,
  AXES,
  ARCHERY,
  UNARMED,
  ACROBATICS,
  REPAIR;

  public String displayName() {
    var lower = name().toLowerCase(java.util.Locale.ROOT);
    return Character.toUpperCase(lower.charAt(0)) + lower.substring(1);
  }
}
