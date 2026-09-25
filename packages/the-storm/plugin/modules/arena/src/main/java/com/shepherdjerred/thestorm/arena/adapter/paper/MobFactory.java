package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.domain.kit.Slot;
import com.shepherdjerred.thestorm.arena.domain.wave.MobArchetype;
import com.shepherdjerred.thestorm.arena.domain.wave.WaveScaling;
import com.shepherdjerred.thestorm.arena.domain.wave.WaveTable;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import net.kyori.adventure.text.Component;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.attribute.Attribute;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.LivingEntity;
import org.bukkit.event.entity.CreatureSpawnEvent.SpawnReason;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;
import org.jspecify.annotations.Nullable;

/**
 * Spawns arena mobs from their archetypes: scaled attributes, equipment that never drops, riders,
 * and the arena tag. Entity types and equipment are checked against the server at enable.
 */
final class MobFactory {

  private final Keys keys;
  private final WaveTable table;
  private final Map<String, Class<? extends LivingEntity>> types;

  private MobFactory(Keys keys, WaveTable table, Map<String, Class<? extends LivingEntity>> types) {
    this.keys = keys;
    this.table = table;
    this.types = Map.copyOf(types);
  }

  /** Checks every archetype's type and equipment, or throws naming every problem. */
  static MobFactory create(Keys keys, WaveTable table) {
    var problems = new ArrayList<String>();
    var types = new HashMap<String, Class<? extends LivingEntity>>();
    for (var entry : table.mobs().entrySet()) {
      var mob = entry.getValue();
      livingType(mob.type())
          .ifPresentOrElse(
              type -> types.put(mob.type(), type),
              () -> problems.add("mob " + entry.getKey() + ": " + mob.type() + " is not a mob"));
      for (var material : mob.equipment().values()) {
        var match = Material.matchMaterial(material);
        if (match == null || !match.isItem()) {
          problems.add("mob " + entry.getKey() + ": " + material + " is not an item");
        }
      }
    }
    if (!problems.isEmpty()) {
      throw new IllegalStateException(
          "Invalid mobs in arena/waves.yml: " + String.join("; ", problems));
    }
    return new MobFactory(keys, table, types);
  }

  private static Optional<Class<? extends LivingEntity>> livingType(String name) {
    EntityType type;
    try {
      type = EntityType.valueOf(name);
    } catch (IllegalArgumentException e) {
      return Optional.empty();
    }
    var entityClass = type.getEntityClass();
    if (entityClass == null
        || !type.isSpawnable()
        || !LivingEntity.class.isAssignableFrom(entityClass)) {
      return Optional.empty();
    }
    return Optional.of(entityClass.asSubclass(LivingEntity.class));
  }

  /**
   * How to scale one spawned mob.
   *
   * @param health a multiplier on vanilla max health, or the absolute max health for bosses
   * @param absolute whether {@code health} is absolute
   * @param damage a multiplier on vanilla attack damage
   */
  record Tuning(double health, boolean absolute, double damage) {

    static Tuning relative(double health, double damage) {
      return new Tuning(health, false, damage);
    }

    static Tuning boss(double maxHealth, double damage) {
      return new Tuning(maxHealth, true, damage);
    }
  }

  /**
   * Spawns archetype {@code mobId} at {@code at} with its riders, all tagged for {@code arena}.
   * Returns every entity spawned, the mount first.
   */
  List<LivingEntity> spawn(Location at, String mobId, Tuning tuning, String arena) {
    var spawned = new ArrayList<LivingEntity>();
    @Nullable LivingEntity below = null;
    var id = mobId;
    var current = tuning;
    while (true) {
      var archetype = table.mob(id);
      var entity = spawnOne(at, archetype, current, arena);
      if (below != null) {
        below.addPassenger(entity);
      }
      spawned.add(entity);
      if (archetype.rider().isEmpty()) {
        return List.copyOf(spawned);
      }
      below = entity;
      id = archetype.rider().orElseThrow();
      // Riders of a boss are ordinary mobs at the boss's damage.
      current = Tuning.relative(current.absolute() ? 1 : current.health(), current.damage());
    }
  }

  private LivingEntity spawnOne(Location at, MobArchetype archetype, Tuning tuning, String arena) {
    var type = types.get(archetype.type());
    if (type == null) {
      throw new IllegalStateException("type was not checked at enable: " + archetype.type());
    }
    var entity =
        at.getWorld()
            .spawn(at, type, mob -> configure(mob, archetype, tuning, arena), SpawnReason.CUSTOM);
    quirks(entity);
    return entity;
  }

  /**
   * Everything about an arena mob that does not need a live server: attributes, name, equipment and
   * the tag. Separate from {@link #quirks} so it can be tested on MockBukkit.
   */
  void configure(LivingEntity mob, MobArchetype archetype, Tuning tuning, String arena) {
    keys.tag(mob, arena);
    mob.setPersistent(false);
    archetype
        .name()
        .ifPresent(
            name -> {
              mob.customName(Component.text(name));
              mob.setCustomNameVisible(true);
            });
    var maxHealth = mob.getAttribute(Attribute.MAX_HEALTH);
    if (maxHealth != null) {
      var health =
          tuning.absolute()
              ? Math.min(WaveScaling.MAX_HEALTH, tuning.health())
              : WaveScaling.absoluteHealth(maxHealth.getBaseValue(), tuning.health());
      maxHealth.setBaseValue(health);
      mob.setHealth(health);
    }
    scale(mob, Attribute.ATTACK_DAMAGE, tuning.damage());
    scale(mob, Attribute.MOVEMENT_SPEED, archetype.speed());
    var size = mob.getAttribute(Attribute.SCALE);
    if (size != null) {
      size.setBaseValue(archetype.scale());
    }
    var equipment = mob.getEquipment();
    if (equipment == null) {
      if (!archetype.equipment().isEmpty()) {
        throw new IllegalStateException(archetype.type() + " cannot wear equipment");
      }
      return;
    }
    for (var item : archetype.equipment().entrySet()) {
      var slot = slot(item.getKey());
      equipment.setItem(slot, ItemStack.of(material(item.getValue())));
      equipment.setDropChance(slot, 0);
    }
  }

  /** Live-server settings MockBukkit does not implement: arena mobs never despawn on their own. */
  static void quirks(LivingEntity mob) {
    mob.setRemoveWhenFarAway(false);
  }

  private static void scale(LivingEntity mob, Attribute attribute, double factor) {
    var instance = mob.getAttribute(attribute);
    if (instance != null) {
      instance.setBaseValue(instance.getBaseValue() * factor);
    }
  }

  private static Material material(String name) {
    var material = Material.matchMaterial(name);
    if (material == null) {
      throw new IllegalStateException("material was not checked at enable: " + name);
    }
    return material;
  }

  static EquipmentSlot slot(Slot slot) {
    return switch (slot) {
      case HEAD -> EquipmentSlot.HEAD;
      case CHEST -> EquipmentSlot.CHEST;
      case LEGS -> EquipmentSlot.LEGS;
      case FEET -> EquipmentSlot.FEET;
      case MAIN_HAND -> EquipmentSlot.HAND;
      case OFF_HAND -> EquipmentSlot.OFF_HAND;
    };
  }
}
