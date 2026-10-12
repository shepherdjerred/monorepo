package com.shepherdjerred.thestorm.rwf.app;

import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import java.util.Optional;

/**
 * What a kit item is used on, for {@link CombatantActions#useKit}.
 *
 * @param target the combatant it is used on, for an item used on someone (the Warper's wand)
 * @param at the point it is aimed at, for an item thrown at a place (the Grappler's hook)
 */
public record KitUse(Optional<CombatantId> target, Optional<Vec3> at) {

  /** Used where the user stands or looks, on nobody in particular. */
  public static final KitUse HERE = new KitUse(Optional.empty(), Optional.empty());
}
