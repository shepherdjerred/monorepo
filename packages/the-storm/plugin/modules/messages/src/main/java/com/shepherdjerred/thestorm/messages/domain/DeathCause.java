package com.shepherdjerred.thestorm.messages.domain;

import static java.util.Map.entry;

import java.util.Arrays;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * Why a player died, grouped the way the death-message catalog is written. Every vanilla damage
 * type maps to exactly one cause.
 */
public enum DeathCause {
  MELEE,
  PROJECTILE,
  EXPLOSION,
  MAGIC,
  BAD_RESPAWN_POINT,
  CACTUS,
  SWEET_BERRY_BUSH,
  DROWNING,
  FALL,
  FLY_INTO_WALL,
  FIRE,
  LAVA,
  HOT_FLOOR,
  LIGHTNING,
  STARVATION,
  SUFFOCATION,
  CRAMMING,
  VOID,
  WORLD_BORDER,
  KILL,
  WITHER,
  THORNS,
  FALLING_BLOCK,
  STALACTITE,
  STALAGMITE,
  FREEZE,
  SONIC_BOOM,
  MACE_SMASH,
  WIND_CHARGE,
  DRAGON_BREATH,
  ENDER_PEARL,
  FIREWORKS,
  GENERIC;

  private static final Set<DeathCause> ATTACKS = Set.of(MELEE, PROJECTILE, EXPLOSION, MAGIC);

  private static final Map<String, DeathCause> BY_DAMAGE_TYPE =
      Map.ofEntries(
          entry("minecraft:mob_attack", MELEE),
          entry("minecraft:mob_attack_no_aggro", MELEE),
          entry("minecraft:player_attack", MELEE),
          entry("minecraft:sting", MELEE),
          entry("minecraft:spear", MELEE),
          entry("minecraft:arrow", PROJECTILE),
          entry("minecraft:trident", PROJECTILE),
          entry("minecraft:mob_projectile", PROJECTILE),
          entry("minecraft:thrown", PROJECTILE),
          entry("minecraft:spit", PROJECTILE),
          entry("minecraft:fireball", PROJECTILE),
          entry("minecraft:unattributed_fireball", PROJECTILE),
          entry("minecraft:wither_skull", PROJECTILE),
          entry("minecraft:explosion", EXPLOSION),
          entry("minecraft:player_explosion", EXPLOSION),
          entry("minecraft:magic", MAGIC),
          entry("minecraft:indirect_magic", MAGIC),
          entry("minecraft:bad_respawn_point", BAD_RESPAWN_POINT),
          entry("minecraft:cactus", CACTUS),
          entry("minecraft:sweet_berry_bush", SWEET_BERRY_BUSH),
          entry("minecraft:drown", DROWNING),
          entry("minecraft:fall", FALL),
          entry("minecraft:fly_into_wall", FLY_INTO_WALL),
          entry("minecraft:in_fire", FIRE),
          entry("minecraft:on_fire", FIRE),
          entry("minecraft:campfire", FIRE),
          entry("minecraft:lava", LAVA),
          entry("minecraft:hot_floor", HOT_FLOOR),
          entry("minecraft:sulfur_cube_hot", HOT_FLOOR),
          entry("minecraft:lightning_bolt", LIGHTNING),
          entry("minecraft:starve", STARVATION),
          entry("minecraft:in_wall", SUFFOCATION),
          entry("minecraft:cramming", CRAMMING),
          entry("minecraft:out_of_world", VOID),
          entry("minecraft:outside_border", WORLD_BORDER),
          entry("minecraft:generic_kill", KILL),
          entry("minecraft:wither", WITHER),
          entry("minecraft:thorns", THORNS),
          entry("minecraft:falling_block", FALLING_BLOCK),
          entry("minecraft:falling_anvil", FALLING_BLOCK),
          entry("minecraft:falling_stalactite", STALACTITE),
          entry("minecraft:stalagmite", STALAGMITE),
          entry("minecraft:freeze", FREEZE),
          entry("minecraft:sonic_boom", SONIC_BOOM),
          entry("minecraft:mace_smash", MACE_SMASH),
          entry("minecraft:wind_charge", WIND_CHARGE),
          entry("minecraft:dragon_breath", DRAGON_BREATH),
          entry("minecraft:ender_pearl", ENDER_PEARL),
          entry("minecraft:fireworks", FIREWORKS),
          entry("minecraft:generic", GENERIC),
          entry("minecraft:dry_out", GENERIC));

  /** The cause for a damage type key such as {@code minecraft:fall}, if the catalog knows it. */
  public static Optional<DeathCause> fromDamageType(String damageTypeKey) {
    return Optional.ofNullable(BY_DAMAGE_TYPE.get(damageTypeKey));
  }

  /** Every damage type key the catalog maps. */
  public static Set<String> knownDamageTypes() {
    return BY_DAMAGE_TYPE.keySet();
  }

  /** The cause named by a config key such as {@code sonic_boom}. */
  public static Optional<DeathCause> fromKey(String key) {
    return Arrays.stream(values()).filter(cause -> cause.key().equals(key)).findFirst();
  }

  /** The config key, such as {@code sonic_boom}. */
  public String key() {
    return name().toLowerCase(Locale.ROOT);
  }

  /**
   * Whether the killer, when there is one, defines the death better than the cause does. A zombie's
   * bite or a skeleton's arrow reads as "killed by a zombie"; a warden's sonic boom or a fall does
   * not.
   */
  public boolean isAttack() {
    return ATTACKS.contains(this);
  }
}
