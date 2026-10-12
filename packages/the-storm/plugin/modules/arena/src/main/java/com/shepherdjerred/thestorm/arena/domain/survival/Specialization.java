package com.shepherdjerred.thestorm.arena.domain.survival;

/** Run-specific identities; persistent experience unlocks classes, never extra power. */
public enum Specialization {
  GUARDIAN(SurvivalClass.FIGHTER),
  VANGUARD(SurvivalClass.FIGHTER),
  MARKSMAN(SurvivalClass.RANGER),
  PIERCER(SurvivalClass.RANGER),
  FIELD_SURGEON(SurvivalClass.MEDIC),
  RESCUER(SurvivalClass.MEDIC),
  FORTIFIER(SurvivalClass.ENGINEER),
  SAPPER(SurvivalClass.ENGINEER),
  CRYOMANCER(SurvivalClass.ALCHEMIST),
  PLAGUE_BREWER(SurvivalClass.ALCHEMIST),
  PACKLEADER(SurvivalClass.BEASTMASTER),
  WARDEN(SurvivalClass.BEASTMASTER);

  private final SurvivalClass role;

  Specialization(SurvivalClass role) {
    this.role = role;
  }

  public SurvivalClass role() {
    return role;
  }
}
