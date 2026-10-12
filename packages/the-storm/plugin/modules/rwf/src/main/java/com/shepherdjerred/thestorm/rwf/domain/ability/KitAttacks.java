// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/abilities/
// DemolitionsAbility.java, ExplosiveAbility.java and SacrificialAbility.java, and
// redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/killstreak/*.java);
// see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.ability;

import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType.Flag;
import java.util.EnumSet;
import java.util.List;
import java.util.Optional;

/** The ways kits and killstreaks kill, with Red Warfare's death messages. */
public final class KitAttacks {

  public static final AttackType LANDMINE =
      attack("Demolitions Landmine", "%Killed% stepped on %Killer%'s landmine", Flag.EXPLOSION);
  public static final AttackType RPG =
      attack("Explosive RPG", "%Killed% was caught by %Killer%'s RPG", Flag.EXPLOSION);
  public static final AttackType RPG_SELF =
      attack(
          "Explosive RPG-Self", "%Killed% was caught in their own RPG explosion", Flag.EXPLOSION);
  public static final AttackType GRENADE =
      attack("Explosive Grenade", "%Killed% was demolished by %Killer%'s grenades", Flag.EXPLOSION);
  public static final AttackType SACRIFICED =
      attack("Sacrificial", "%Killed% was killed protecting an ally", Flag.NO_KNOCKBACK);
  public static final AttackType WALL =
      attack(
          "Inertia Wall",
          "%Killed% ran into a wall a little too fast",
          Flag.IGNORE_ARMOR,
          Flag.NO_KNOCKBACK);

  /**
   * Napalm's fire. Red Warfare gave it only {@code setFire()}, so unlike the plain fire tick it
   * replaces, armour counts against it.
   */
  public static final AttackType NAPALM =
      attack("Napalm Fire", "%Killed% was charred to a crisp by %Killer%'s napalm", Flag.FIRE);

  public static final AttackType NAPALM_BLAST =
      attack(
          "Napalm Explosion",
          "%Killed% was charred to a crisp by %Killer%'s napalm",
          Flag.EXPLOSION);

  /** Every kit and killstreak attack, for lookups by name. */
  public static final List<AttackType> ALL =
      List.of(LANDMINE, RPG, RPG_SELF, GRENADE, SACRIFICED, WALL, NAPALM, NAPALM_BLAST);

  private KitAttacks() {}

  /** The attack named {@code name}, if a kit or killstreak deals it. */
  public static Optional<AttackType> named(String name) {
    return ALL.stream().filter(attack -> attack.name().equals(name)).findFirst();
  }

  private static AttackType attack(String name, String death, Flag... flags) {
    var set = EnumSet.noneOf(Flag.class);
    set.addAll(List.of(flags));
    return new AttackType(name, death, set);
  }
}
