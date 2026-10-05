package com.shepherdjerred.thestorm.arena.domain.survival;

import java.util.EnumSet;
import java.util.Optional;
import java.util.Set;

/** Purchased boons belong to a run; two equipped choices form the survivor's current build. */
public final class BoonLoadout {
  private final Set<SurvivalPerk> purchased = EnumSet.noneOf(SurvivalPerk.class);
  private final Set<SurvivalPerk> equipped = EnumSet.noneOf(SurvivalPerk.class);

  public Set<SurvivalPerk> equipped() {
    return Set.copyOf(equipped);
  }

  public boolean purchased(SurvivalPerk boon) {
    return purchased.contains(boon);
  }

  public boolean has(SurvivalPerk boon) {
    return equipped.contains(boon);
  }

  public boolean canEquip(SurvivalPerk boon, Optional<SurvivalPerk> replace) {
    if (equipped.contains(boon)) return false;
    return equipped.size() < 2 ? replace.isEmpty() : replace.filter(equipped::contains).isPresent();
  }

  public void equip(SurvivalPerk boon, Optional<SurvivalPerk> replace) {
    if (!canEquip(boon, replace)) throw new IllegalArgumentException("Choose a valid boon slot");
    replace.ifPresent(equipped::remove);
    purchased.add(boon);
    equipped.add(boon);
  }
}
