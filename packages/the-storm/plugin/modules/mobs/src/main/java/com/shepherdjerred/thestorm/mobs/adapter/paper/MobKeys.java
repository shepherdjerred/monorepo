package com.shepherdjerred.thestorm.mobs.adapter.paper;

import com.shepherdjerred.thestorm.mobs.domain.scaling.Stat;
import java.util.Locale;
import org.bukkit.NamespacedKey;

/** The persistent-data and attribute-modifier keys the mobs module uses. */
final class MobKeys {

  private static final String NAMESPACE = "thestorm";

  /** A levelled mob's level (integer). */
  static final NamespacedKey LEVEL = new NamespacedKey(NAMESPACE, "mob_level");

  /** Set by the arena on its mobs (any type); such mobs are never levelled. */
  static final NamespacedKey ARENA = new NamespacedKey(NAMESPACE, "arena");

  private MobKeys() {}

  /** The attribute modifier a level adds for {@code stat}, so it can be found and removed. */
  static NamespacedKey modifier(Stat stat) {
    return new NamespacedKey(NAMESPACE, "mob_level_" + stat.name().toLowerCase(Locale.ROOT));
  }
}
