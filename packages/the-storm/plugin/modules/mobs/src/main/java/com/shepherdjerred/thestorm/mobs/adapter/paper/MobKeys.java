package com.shepherdjerred.thestorm.mobs.adapter.paper;

import com.shepherdjerred.thestorm.mobs.domain.scaling.Stat;
import java.util.Locale;
import org.bukkit.NamespacedKey;

/** The persistent-data and attribute-modifier keys the mobs module uses. */
final class MobKeys {

  private static final String NAMESPACE = "thestorm";

  /** A levelled mob's level (integer). */
  static final NamespacedKey LEVEL = new NamespacedKey(NAMESPACE, "mob_level");

  /** Damage players dealt a levelled mob with their own hits and projectiles (double). */
  static final NamespacedKey PLAYER_DAMAGE = new NamespacedKey(NAMESPACE, "mob_player_damage");

  /** Damage a levelled mob took from everything else (double). */
  static final NamespacedKey OTHER_DAMAGE = new NamespacedKey(NAMESPACE, "mob_other_damage");

  /**
   * The arena module's tag on every entity it spawns (any type). A contract between modules: the
   * arena sets it before the entity is added to the world, and mobs never levels such an entity.
   */
  static final NamespacedKey ARENA_ENTITY = new NamespacedKey(NAMESPACE, "arena_entity");

  private MobKeys() {}

  /** The attribute modifier a level adds for {@code stat}, so it can be found and removed. */
  static NamespacedKey modifier(Stat stat) {
    return new NamespacedKey(NAMESPACE, "mob_level_" + stat.name().toLowerCase(Locale.ROOT));
  }
}
