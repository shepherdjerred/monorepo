package com.shepherdjerred.thestorm.arena.domain.survival;

import java.util.Optional;

/** Three earned choices survive downing, but belong exclusively to the current run. */
public final class SurvivalBuild {
  public enum Upgrade {
    POTENCY,
    TEMPO
  }

  private final SurvivalClass role;
  private Optional<Specialization> specialization = Optional.empty();
  private int cleared;
  private int potency;
  private int tempo;

  public SurvivalBuild(SurvivalClass role) {
    this.role = role;
  }

  public SurvivalClass role() {
    return role;
  }

  public Optional<Specialization> specialization() {
    return specialization;
  }

  public void cleared(int round) {
    cleared = Math.max(cleared, round);
  }

  public int pending() {
    var earned = cleared >= 14 ? 3 : cleared >= 9 ? 2 : cleared >= 4 ? 1 : 0;
    return earned - (specialization.isPresent() ? 1 : 0) - potency - tempo;
  }

  public int nextMilestone() {
    return cleared < 4 ? 4 : cleared < 9 ? 9 : cleared < 14 ? 14 : 0;
  }

  public boolean select(Specialization choice) {
    if (choice.role() != role || specialization.isPresent() || pending() == 0) return false;
    specialization = Optional.of(choice);
    return true;
  }

  public boolean upgrade(Upgrade choice) {
    if (specialization.isEmpty() || pending() == 0) return false;
    switch (choice) {
      case POTENCY -> potency++;
      case TEMPO -> tempo++;
    }
    return true;
  }

  public int potency() {
    return potency;
  }

  public int tempo() {
    return tempo;
  }

  public double magnitude(double base) {
    return base * (1 + potency * .25);
  }

  public int utilitySeconds(int base) {
    return base + potency * 2;
  }

  public int cooldownSeconds() {
    return 40 - tempo * 6;
  }
}
