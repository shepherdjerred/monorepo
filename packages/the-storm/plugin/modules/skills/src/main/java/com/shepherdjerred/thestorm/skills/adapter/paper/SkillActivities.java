package com.shepherdjerred.thestorm.skills.adapter.paper;

import com.shepherdjerred.thestorm.skills.domain.Skill;
import java.util.Optional;
import org.bukkit.Material;
import org.bukkit.Tag;
import org.bukkit.block.Block;
import org.bukkit.block.data.Ageable;
import org.bukkit.entity.Arrow;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Projectile;
import org.bukkit.entity.SpectralArrow;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.inventory.ItemStack;

/** Classifies server actions once, at the Paper boundary. */
final class SkillActivities {

  private SkillActivities() {}

  static Optional<Skill> block(Block block) {
    var material = block.getType();
    if (Tag.LOGS.isTagged(material)) {
      return Optional.of(Skill.WOODCUTTING);
    }
    if (isCrop(material) && block.getBlockData() instanceof Ageable age) {
      return age.getAge() == age.getMaximumAge() ? Optional.of(Skill.HERBALISM) : Optional.empty();
    }
    if (Tag.FLOWERS.isTagged(material) || material == Material.SHORT_GRASS) {
      return Optional.of(Skill.HERBALISM);
    }
    if (isExcavation(material)) {
      return Optional.of(Skill.EXCAVATION);
    }
    // Stone can be generated indefinitely by lava and water without a placement event.
    // Ore has a finite natural source and is safe to count for Mining.
    if (isOre(material)) {
      return Optional.of(Skill.MINING);
    }
    return Optional.empty();
  }

  static int blockExperience(Skill skill, Material material) {
    return switch (skill) {
      case MINING -> {
        if (!isOre(material)) {
          throw new IllegalArgumentException("not a mining ore: " + material);
        }
        yield 20;
      }
      case WOODCUTTING -> 12;
      case EXCAVATION -> 4;
      case HERBALISM -> 8;
      default -> throw new IllegalArgumentException("not a gathering skill: " + skill);
    };
  }

  static Optional<Skill> combat(EntityDamageByEntityEvent event, ItemStack weapon) {
    Entity attacker = event.getDamager();
    if (isArcheryProjectile(attacker) && attacker instanceof Projectile projectile) {
      return projectile.getShooter() instanceof org.bukkit.entity.Player
          ? Optional.of(Skill.ARCHERY)
          : Optional.empty();
    }
    if (!(attacker instanceof org.bukkit.entity.Player)) {
      return Optional.empty();
    }
    return melee(weapon.getType());
  }

  static boolean isArcheryProjectile(Entity entity) {
    return entity instanceof Arrow || entity instanceof SpectralArrow;
  }

  static Optional<Skill> melee(Material material) {
    String name = material.name();
    if (name.endsWith("_SWORD")) {
      return Optional.of(Skill.SWORDS);
    }
    if (name.endsWith("_AXE") || material == Material.MACE) {
      return Optional.of(Skill.AXES);
    }
    return material.isAir() ? Optional.of(Skill.UNARMED) : Optional.empty();
  }

  static boolean isCrop(Material material) {
    return switch (material) {
      case WHEAT, CARROTS, POTATOES, BEETROOTS, NETHER_WART, COCOA, SWEET_BERRY_BUSH -> true;
      default -> false;
    };
  }

  static boolean isFertilizedPlant(Material material) {
    return Tag.FLOWERS.isTagged(material) || material == Material.SHORT_GRASS;
  }

  static boolean isTreeStarter(Material material) {
    return Tag.SAPLINGS.isTagged(material)
        || material == Material.MANGROVE_PROPAGULE
        || material == Material.AZALEA
        || material == Material.FLOWERING_AZALEA
        || material == Material.CRIMSON_FUNGUS
        || material == Material.WARPED_FUNGUS;
  }

  private static boolean isExcavation(Material material) {
    return switch (material) {
      case DIRT, GRASS_BLOCK, COARSE_DIRT, PODZOL, ROOTED_DIRT, SAND, RED_SAND, GRAVEL, CLAY, MUD ->
          true;
      default -> false;
    };
  }

  private static boolean isOre(Material material) {
    return material.name().endsWith("_ORE") || material == Material.ANCIENT_DEBRIS;
  }
}
