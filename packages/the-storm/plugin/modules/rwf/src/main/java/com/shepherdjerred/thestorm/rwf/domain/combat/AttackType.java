// Ported from libraryaddict's Red Warfare
// (redwarfare-core/src/me/libraryaddict/core/damage/AttackType.java and
// redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/SearchAndDestroy.java); see
// packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.combat;

import java.util.EnumSet;
import java.util.List;
import java.util.Set;

/**
 * A kind of damage and how the rules treat it. {@code %Killed%} and {@code %Killer%} in the death
 * message are filled in by the adapter.
 *
 * @param name the name shown in combat logs
 * @param deathMessage the death message template
 * @param flags how the damage behaves
 */
public record AttackType(String name, String deathMessage, Set<Flag> flags) {

  /** How a kind of damage behaves. */
  public enum Flag {
    /** Fire protection applies. */
    BURN,
    /** Blast protection applies; knockback is applied even inside the hit window. */
    EXPLOSION,
    /** Feather falling applies; armor and the hit window are ignored. */
    FALL,
    /** The victim is set on fire (implies {@link #BURN}). */
    FIRE,
    /** Armor and Protection do nothing. */
    IGNORE_ARMOR,
    /** The hit window does not apply. */
    IGNORE_RATE,
    /** The victim dies whatever their health. */
    INSTANT_DEATH,
    /** No knockback. */
    NO_KNOCKBACK,
    /** Sword enchantments and the extra-damage rule apply. */
    MELEE,
    /** Projectile protection applies. */
    PROJECTILE,
  }

  public static final AttackType CACTUS =
      of("Cactus", "%Killed% licked a cactus", Flag.NO_KNOCKBACK);
  public static final AttackType DAMAGE_POTION =
      of(
          "Damage Potion",
          "%Killed% died to %Killer%'s damage potion which isn't part of the game?",
          Flag.NO_KNOCKBACK);
  public static final AttackType DRAGON_BREATH =
      of("Dragon Breath", "%Killed% sucked a lungfull of dragon's breath", Flag.NO_KNOCKBACK);
  public static final AttackType DROWNED =
      of("Drowned", "%Killed% is swimming with the fishes", Flag.IGNORE_ARMOR, Flag.NO_KNOCKBACK);
  public static final AttackType EXPLOSION =
      of("Explosion", "%Killed% was caught in an explosion", Flag.EXPLOSION);
  public static final AttackType FALL =
      of("Fall", "%Killed% fell to their death", Flag.FALL, Flag.NO_KNOCKBACK);
  public static final AttackType FALL_PUSHED =
      of(
          "Pushed Fall",
          "%Killed% was pushed to their death by %Killer%",
          Flag.FALL,
          Flag.NO_KNOCKBACK);
  public static final AttackType FALL_SHOT =
      of(
          "Shot Fall",
          "%Killed% was shot by %Killer% and fell to their death",
          Flag.FALL,
          Flag.NO_KNOCKBACK);
  public static final AttackType FALLING_BLOCK =
      of("Falling Block", "%Killed% was crushed beneath a falling block");
  public static final AttackType FIRE =
      of("Direct Fire", "%Killed% stood inside flames and laughed", Flag.NO_KNOCKBACK, Flag.BURN);
  public static final AttackType FIRE_ASPECT =
      of(
          "Fire Aspect",
          "%Killed% was charred to a crisp by %Killer%",
          Flag.FIRE,
          Flag.NO_KNOCKBACK,
          Flag.IGNORE_ARMOR);
  public static final AttackType FIRE_BOW =
      of(
          "Fire Bow",
          "%Killed% charred to a crisp by %Killer%'s bow",
          Flag.FIRE,
          Flag.NO_KNOCKBACK,
          Flag.IGNORE_ARMOR);
  public static final AttackType FIRE_TICK =
      of("Fire Tick", "%Killed% was burned alive", Flag.NO_KNOCKBACK, Flag.FIRE, Flag.IGNORE_ARMOR);
  public static final AttackType FISHING_HOOK =
      of("Fishing Hook", "%Killed% was killed by %Killer%'s... Fishing rod?");
  public static final AttackType FLY_INTO_WALL =
      of("Flew into Wall", "%Killed% still hadn't gotten the hang of flying", Flag.NO_KNOCKBACK);
  public static final AttackType LAVA =
      of("Lava", "%Killed% tried to swim in lava", Flag.NO_KNOCKBACK, Flag.BURN);
  public static final AttackType LIGHTNING =
      of("Lightning", "%Killed% was electrified by lightning", Flag.NO_KNOCKBACK);
  public static final AttackType MAGMA =
      of("Magma", "%Killed% took a rest on some hot magma", Flag.NO_KNOCKBACK, Flag.BURN);
  public static final AttackType MELEE =
      of("Melee", "%Killed% was murdered by %Killer%", Flag.MELEE);
  public static final AttackType MELTING =
      of("Melting", "%Killed% melted in the hot sun", Flag.NO_KNOCKBACK);
  public static final AttackType POISON =
      of("Poison", "%Killed% drank a flask of poison", Flag.IGNORE_ARMOR, Flag.NO_KNOCKBACK);
  public static final AttackType PROJECTILE =
      of("Projectile", "%Killed% was shot by %Killer%", Flag.PROJECTILE);
  public static final AttackType QUIT =
      of("Quit", "%Killed% has left the game", Flag.INSTANT_DEATH, Flag.NO_KNOCKBACK);
  public static final AttackType STARVATION =
      of("Starvation", "%Killed% died from starvation", Flag.IGNORE_ARMOR, Flag.NO_KNOCKBACK);
  public static final AttackType SUFFOCATION =
      of("Suffocation", "%Killed% choked on block", Flag.NO_KNOCKBACK);
  public static final AttackType SUICIDE =
      of("Suicide", "%Killed% commited suicide", Flag.INSTANT_DEATH, Flag.NO_KNOCKBACK);
  public static final AttackType SUICIDE_ASSISTED =
      of(
          "Assisted Suicide",
          "%Killed% was assisted on the path to suicide",
          Flag.INSTANT_DEATH,
          Flag.NO_KNOCKBACK);
  public static final AttackType THORNS =
      of("Thorns", "%Killed% found out how the thorns enchantment works", Flag.NO_KNOCKBACK);
  public static final AttackType UNKNOWN =
      of("Unknown", "%Killed% died from unknown causes", Flag.NO_KNOCKBACK);
  public static final AttackType VOID =
      of(
          "Void",
          "%Killed% fell into the void",
          Flag.IGNORE_ARMOR,
          Flag.NO_KNOCKBACK,
          Flag.IGNORE_RATE);
  public static final AttackType VOID_PUSHED =
      of(
          "Void Pushed",
          "%Killed% was knocked into the void by %Killer%",
          Flag.IGNORE_ARMOR,
          Flag.NO_KNOCKBACK,
          Flag.IGNORE_RATE);
  public static final AttackType VOID_SHOT =
      of(
          "Void Shot",
          "%Killed% was shot into the void by %Killer%",
          Flag.IGNORE_ARMOR,
          Flag.NO_KNOCKBACK,
          Flag.IGNORE_RATE);
  public static final AttackType WITHER_POISON =
      of("Wither Poison", "%Killed% drank a vial of wither poison", Flag.NO_KNOCKBACK);

  /** Search and Destroy: a team's own bomb went off. */
  public static final AttackType BOMB_EXPLODE =
      of("Bomb Exploded", "%Killed% was caught in the explosion of their bomb", Flag.INSTANT_DEATH);

  /** Search and Destroy: the end-of-game poison. */
  public static final AttackType END_OF_GAME =
      of(
          "End of Game",
          "%Killed% was unable of escape the strings of time",
          Flag.IGNORE_ARMOR,
          Flag.NO_KNOCKBACK);

  /** Every attack type, for lookups by name. */
  public static final List<AttackType> ALL =
      List.of(
          CACTUS,
          DAMAGE_POTION,
          DRAGON_BREATH,
          DROWNED,
          EXPLOSION,
          FALL,
          FALL_PUSHED,
          FALL_SHOT,
          FALLING_BLOCK,
          FIRE,
          FIRE_ASPECT,
          FIRE_BOW,
          FIRE_TICK,
          FISHING_HOOK,
          FLY_INTO_WALL,
          LAVA,
          LIGHTNING,
          MAGMA,
          MELEE,
          MELTING,
          POISON,
          PROJECTILE,
          QUIT,
          STARVATION,
          SUFFOCATION,
          SUICIDE,
          SUICIDE_ASSISTED,
          THORNS,
          UNKNOWN,
          VOID,
          VOID_PUSHED,
          VOID_SHOT,
          WITHER_POISON,
          BOMB_EXPLODE,
          END_OF_GAME);

  public AttackType {
    if (name.isBlank() || deathMessage.isBlank()) {
      throw new IllegalArgumentException("attack type needs a name and a death message");
    }
    var all = EnumSet.noneOf(Flag.class);
    all.addAll(flags);
    // The original's setFall also ignored armor and the hit window; setFire also burned.
    if (all.contains(Flag.FALL)) {
      all.add(Flag.IGNORE_ARMOR);
      all.add(Flag.IGNORE_RATE);
    }
    if (all.contains(Flag.FIRE)) {
      all.add(Flag.BURN);
    }
    flags = Set.copyOf(all);
  }

  private static AttackType of(String name, String deathMessage, Flag... flags) {
    return new AttackType(name, deathMessage, Set.of(flags));
  }

  public boolean has(Flag flag) {
    return flags.contains(flag);
  }

  public boolean knockback() {
    return !has(Flag.NO_KNOCKBACK);
  }
}
