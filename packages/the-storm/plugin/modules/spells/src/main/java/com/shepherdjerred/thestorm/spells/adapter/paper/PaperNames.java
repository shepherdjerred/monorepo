package com.shepherdjerred.thestorm.spells.adapter.paper;

import com.shepherdjerred.thestorm.spells.domain.config.SpellSettings;
import com.shepherdjerred.thestorm.spells.domain.config.SpellsConfig;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.Particle;
import org.bukkit.Registry;
import org.bukkit.Sound;
import org.bukkit.block.BlockType;
import org.bukkit.block.TileState;
import org.bukkit.entity.EntityType;

/**
 * Resolves the Paper names in {@code spells.yml} (materials, particles, sounds, entity types and
 * item models) against the running server, so a typo or a pre-1.13 name stops the module at enable
 * instead of failing on the first cast.
 */
public final class PaperNames {

  private PaperNames() {}

  /** Every problem with the config's Paper names; empty when all resolve. */
  public static List<String> problems(SpellsConfig config) {
    var problems = new ArrayList<String>();
    itemModel(config.scroll().model()).ifPresent(p -> problems.add("scroll.model: " + p));
    if (sound(config.scroll().sound()).isEmpty()) {
      problems.add("scroll.sound: unknown sound " + config.scroll().sound());
    }
    for (var name : config.immuneEntities()) {
      if (entityType(name).isEmpty()) {
        problems.add("immuneEntities: unknown living entity " + name);
      }
    }
    config
        .spells()
        .all()
        .forEach(
            (kind, entry) -> {
              var prefix = "spells." + kind.id() + ".";
              entry
                  .reagents()
                  .keySet()
                  .forEach(
                      material -> {
                        if (item(material).isEmpty()) {
                          problems.add(prefix + "reagents: unknown item " + material);
                        }
                      });
              itemModel(entry.look().model())
                  .ifPresent(p -> problems.add(prefix + "look.model: " + p));
              if (particle(entry.fx().particle()).isEmpty()) {
                problems.add(
                    prefix + "fx.particle: unknown or data-bearing " + entry.fx().particle());
              }
              if (sound(entry.fx().sound()).isEmpty()) {
                problems.add(prefix + "fx.sound: unknown sound " + entry.fx().sound());
              }
              settingsProblems(entry.settings())
                  .forEach(p -> problems.add(prefix + "settings." + p));
            });
    return problems;
  }

  private static List<String> settingsProblems(Object settings) {
    return switch (settings) {
      case SpellSettings.Wall wall -> solidBlock("material", wall.material());
      case SpellSettings.Carpet carpet -> solidBlock("material", carpet.material());
      case SpellSettings.Entomb entomb -> solidBlock("material", entomb.material());
      case SpellSettings.Freeze freeze -> solidBlock("iceMaterial", freeze.iceMaterial());
      case SpellSettings.Divine divine ->
          divine.blocks().stream()
              .filter(name -> block(name).isEmpty())
              .map(name -> "blocks: unknown block " + name)
              .toList();
      default -> List.of();
    };
  }

  private static List<String> solidBlock(String field, String name) {
    return solid(name).isPresent()
        ? List.of()
        : List.of(field + ": " + name + " is not a solid block without a block entity");
  }

  /** An item material, for reagents. */
  public static Optional<Material> item(String name) {
    return Optional.ofNullable(Registry.ITEM.get(key(name))).flatMap(type -> material(name));
  }

  /** Any block material, for Divine. */
  public static Optional<Material> block(String name) {
    return blockType(name).flatMap(type -> material(name));
  }

  /**
   * A full, solid block for temporary blocks: nothing with a block entity (it could hold items) and
   * nothing that falls or flows.
   */
  public static Optional<Material> solid(String name) {
    return blockType(name)
        .filter(BlockType::isSolid)
        .filter(type -> !type.hasGravity())
        .filter(type -> !(type.createBlockData().createBlockState() instanceof TileState))
        .flatMap(type -> material(name));
  }

  private static Optional<BlockType> blockType(String name) {
    return Optional.ofNullable(Registry.BLOCK.get(key(name)));
  }

  private static Optional<Material> material(String name) {
    return Optional.ofNullable(Material.getMaterial(name));
  }

  /** The vanilla registry key for an upper-case name: {@code LAPIS_LAZULI} -> lapis_lazuli. */
  private static NamespacedKey key(String name) {
    return NamespacedKey.minecraft(name.toLowerCase(Locale.ROOT));
  }

  /** A particle that needs no extra data. */
  public static Optional<Particle> particle(String name) {
    return Arrays.stream(Particle.values())
        .filter(particle -> particle.name().equals(name))
        .filter(particle -> particle.getDataType() == Void.class)
        .findFirst();
  }

  /** A sound event by key, for example {@code entity.blaze.shoot}. */
  public static Optional<Sound> sound(String key) {
    return Optional.ofNullable(Registry.SOUND_EVENT.get(NamespacedKey.minecraft(key)));
  }

  /** A living entity type by name. */
  public static Optional<EntityType> entityType(String name) {
    return Arrays.stream(EntityType.values())
        .filter(type -> type.name().equals(name) && type.isAlive())
        .findFirst();
  }

  /**
   * A problem with an item model key, if any. A {@code minecraft:} model must be a vanilla item's;
   * other namespaces come from the server resource pack and cannot be checked here.
   */
  private static Optional<String> itemModel(String key) {
    var parsed = NamespacedKey.fromString(key);
    if (parsed == null) {
      return Optional.of("not a namespaced key: " + key);
    }
    if (!parsed.getNamespace().equals(NamespacedKey.MINECRAFT)) {
      return Optional.empty();
    }
    return item(parsed.getKey().toUpperCase(Locale.ROOT)).isPresent()
        ? Optional.empty()
        : Optional.of("no vanilla item model " + key);
  }
}
