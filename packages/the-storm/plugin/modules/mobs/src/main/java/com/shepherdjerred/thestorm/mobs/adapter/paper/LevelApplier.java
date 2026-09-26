package com.shepherdjerred.thestorm.mobs.adapter.paper;

import com.shepherdjerred.thestorm.mobs.app.MobLevels;
import com.shepherdjerred.thestorm.mobs.domain.config.Nameplate;
import com.shepherdjerred.thestorm.mobs.domain.scaling.Scaling;
import com.shepherdjerred.thestorm.mobs.domain.scaling.Stat;
import java.util.Map;
import java.util.OptionalInt;
import java.util.function.BiConsumer;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextColor;
import org.bukkit.attribute.Attribute;
import org.bukkit.attribute.AttributeModifier;
import org.bukkit.entity.Entity;
import org.bukkit.entity.LivingEntity;
import org.bukkit.inventory.EquipmentSlotGroup;
import org.bukkit.persistence.PersistentDataType;

/**
 * Gives mobs their level and takes it away again: one keyed attribute modifier per stat, the level
 * in persistent data, and the nameplate. Main thread only.
 */
final class LevelApplier implements MobLevels {

  /** The stats carried by attributes; the rest are applied when damage or rewards happen. */
  private static final Map<Stat, Attribute> ATTRIBUTES =
      Map.of(
          Stat.MAX_HEALTH, Attribute.MAX_HEALTH,
          Stat.ATTACK_DAMAGE, Attribute.ATTACK_DAMAGE,
          Stat.MOVEMENT_SPEED, Attribute.MOVEMENT_SPEED,
          Stat.ARMOR, Attribute.ARMOR,
          Stat.ARMOR_TOUGHNESS, Attribute.ARMOR_TOUGHNESS);

  private final Scaling scaling;
  private final int cap;
  private final Nameplate nameplate;
  private final BiConsumer<LivingEntity, Runnable> namedMobPersistence;

  LevelApplier(Scaling scaling, int cap, Nameplate nameplate) {
    this(scaling, cap, nameplate, LevelApplier::preserveDespawn);
  }

  LevelApplier(
      Scaling scaling,
      int cap,
      Nameplate nameplate,
      BiConsumer<LivingEntity, Runnable> namedMobPersistence) {
    this.scaling = scaling;
    this.cap = cap;
    this.nameplate = nameplate;
    this.namedMobPersistence = namedMobPersistence;
  }

  /** Makes {@code mob} a level-{@code level} mob at full health. */
  void apply(LivingEntity mob, int level) {
    var type = typeKey(mob);
    ATTRIBUTES.forEach(
        (stat, attribute) -> {
          var instance = mob.getAttribute(attribute);
          if (instance == null) {
            return;
          }
          var key = MobKeys.modifier(stat);
          instance.removeModifier(key);
          var bonus = scaling.bonus(stat, type, level, cap);
          if (bonus > 0) {
            instance.addModifier(
                new AttributeModifier(key, bonus, operation(stat), EquipmentSlotGroup.ANY));
          }
        });
    var maxHealth = mob.getAttribute(Attribute.MAX_HEALTH);
    if (maxHealth != null) {
      mob.setHealth(maxHealth.getValue());
    }
    mob.getPersistentDataContainer().set(MobKeys.LEVEL, PersistentDataType.INTEGER, level);
    if (nameplate.enabled()) {
      namedMobPersistence.accept(
          mob,
          () -> {
            mob.customName(nameplate(mob, level));
            mob.setCustomNameVisible(nameplate.alwaysVisible());
          });
    }
  }

  static void preserveDespawn(LivingEntity mob, Runnable name) {
    var removeWhenFarAway = mob.getRemoveWhenFarAway();
    name.run();
    // A level plate must not turn an ordinary natural spawn into a permanent mob.
    mob.setRemoveWhenFarAway(removeWhenFarAway);
  }

  @Override
  public OptionalInt levelOf(Entity entity) {
    var level = entity.getPersistentDataContainer().get(MobKeys.LEVEL, PersistentDataType.INTEGER);
    return level == null ? OptionalInt.empty() : OptionalInt.of(level);
  }

  @Override
  public void strip(LivingEntity mob) {
    var level = levelOf(mob);
    if (level.isEmpty()) {
      return;
    }
    clear(mob, nameplate(mob, level.getAsInt()));
  }

  /**
   * Removes every trace of a level from {@code mob}: modifiers, level and damage tags, and the name
   * {@code plate} if the mob still wears it. Used for mobs that inherited a level by converting
   * from another mob, whose nameplate names the old type.
   */
  void clear(LivingEntity mob, Component plate) {
    ATTRIBUTES.forEach(
        (stat, attribute) -> {
          var instance = mob.getAttribute(attribute);
          if (instance != null) {
            instance.removeModifier(MobKeys.modifier(stat));
          }
        });
    var maxHealth = mob.getAttribute(Attribute.MAX_HEALTH);
    if (maxHealth != null && mob.getHealth() > maxHealth.getValue()) {
      mob.setHealth(maxHealth.getValue());
    }
    var data = mob.getPersistentDataContainer();
    data.remove(MobKeys.LEVEL);
    data.remove(MobKeys.PLAYER_DAMAGE);
    data.remove(MobKeys.OTHER_DAMAGE);
    // Only our own nameplate is removed; a name a player gave the mob since stays.
    if (plate.equals(mob.customName())) {
      mob.customName(null);
      mob.setCustomNameVisible(false);
    }
  }

  /** {@code stat}'s bonus for {@code mob}, or 0 if it has no level. */
  double bonus(LivingEntity mob, Stat stat) {
    var level = levelOf(mob);
    if (level.isEmpty()) {
      return 0;
    }
    return scaling.bonus(stat, typeKey(mob), Math.min(level.getAsInt(), cap), cap);
  }

  /** The nameplate a level-{@code level} {@code mob} wears. */
  Component nameplate(LivingEntity mob, int level) {
    var hex = nameplate.colorFor(level);
    var color = TextColor.fromHexString(hex);
    if (color == null) {
      throw new IllegalStateException("nameplate colors are validated as #RRGGBB: " + hex);
    }
    return Component.text("Lv " + level, color)
        .append(Component.space())
        .append(Component.translatable(mob.getType(), NamedTextColor.WHITE));
  }

  private static AttributeModifier.Operation operation(Stat stat) {
    return switch (stat.kind()) {
      case SHARE -> AttributeModifier.Operation.ADD_SCALAR;
      case POINTS -> AttributeModifier.Operation.ADD_NUMBER;
    };
  }

  /** The entity type's key without namespace, as {@code mobs.yml} names types. */
  static String typeKey(Entity entity) {
    return entity.getType().key().value();
  }
}
