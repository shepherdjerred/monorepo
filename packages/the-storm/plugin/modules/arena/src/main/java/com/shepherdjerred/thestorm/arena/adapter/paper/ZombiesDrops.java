package com.shepherdjerred.thestorm.arena.adapter.paper;

import java.time.Instant;
import java.util.EnumMap;
import java.util.Map;
import net.kyori.adventure.text.Component;
import org.bukkit.Material;
import org.bukkit.entity.ItemDisplay;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.TextDisplay;
import org.jspecify.annotations.Nullable;

/** One team pickup at a time, with bounded lifetimes and shared temporary buffs. */
final class ZombiesDrops {
  enum Kind {
    MAX_AMMO,
    DOUBLE_EMERALDS,
    INSTA_KILL,
    NUKE,
    CARPENTER
  }

  private final SurvivalRunner runner;
  private final Map<Kind, Instant> buffs = new EnumMap<>(Kind.class);
  private Instant nextDrop = Instant.MIN;
  private Instant expires = Instant.MIN;
  private @Nullable Kind kind;
  private @Nullable ItemDisplay display;
  private @Nullable TextDisplay label;

  ZombiesDrops(SurvivalRunner runner) {
    this.runner = runner;
  }

  boolean instaKill() {
    return runner
        .context()
        .time()
        .instant()
        .isBefore(buffs.getOrDefault(Kind.INSTA_KILL, Instant.MIN));
  }

  void died(LivingEntity enemy) {
    var now = runner.context().time().instant();
    if (display != null || now.isBefore(nextDrop) || runner.context().random().nextInt(100) >= 8)
      return;
    kind = Kind.values()[runner.context().random().nextInt(Kind.values().length)];
    var location = enemy.getLocation().add(0, 1, 0);
    display = enemy.getWorld().spawn(location, ItemDisplay.class);
    display.setItemStack(org.bukkit.inventory.ItemStack.of(icon(kind)));
    display.setPersistent(false);
    runner.tag(display);
    label = enemy.getWorld().spawn(location.clone().add(0, .6, 0), TextDisplay.class);
    label.text(Component.text(name(kind)));
    label.setBillboard(org.bukkit.entity.Display.Billboard.CENTER);
    label.setPersistent(false);
    runner.tag(label);
    expires = now.plusSeconds(20);
    nextDrop = now.plusSeconds(30);
  }

  private static Material icon(Kind kind) {
    return switch (kind) {
      case MAX_AMMO -> Material.ARROW;
      case DOUBLE_EMERALDS -> Material.EMERALD;
      case INSTA_KILL -> Material.DIAMOND_SWORD;
      case NUKE -> Material.TNT;
      case CARPENTER -> Material.OAK_PLANKS;
    };
  }

  private static String name(Kind kind) {
    return switch (kind) {
      case MAX_AMMO -> "Max Ammo";
      case DOUBLE_EMERALDS -> "Double Emeralds";
      case INSTA_KILL -> "Insta-Kill";
      case NUKE -> "Nuke";
      case CARPENTER -> "Carpenter";
    };
  }

  private static String effect(Kind kind) {
    return switch (kind) {
      case MAX_AMMO -> "32 arrows for each ranged survivor";
      case DOUBLE_EMERALDS -> "Double kill rewards · 30 seconds";
      case INSTA_KILL -> "One-hit ordinary enemies · 15 seconds";
      case NUKE -> "Ordinary enemies cleared";
      case CARPENTER -> "Barricades restored + 2 hearts healed";
    };
  }

  void tick() {
    var now = runner.context().time().instant();
    runner
        .combat()
        .doubleEmeralds(now.isBefore(buffs.getOrDefault(Kind.DOUBLE_EMERALDS, Instant.MIN)));
    var pickup = display;
    if (pickup == null) return;
    if (!pickup.isValid() || !now.isBefore(expires)) {
      clear();
      return;
    }
    if (runner.fighters().stream()
        .noneMatch(p -> Places.at(p).distanceSquared(pickup.getLocation()) <= 4)) return;
    var drop = java.util.Objects.requireNonNull(kind);
    switch (drop) {
      case MAX_AMMO ->
          runner
              .fighters()
              .forEach(
                  p -> {
                    if (java.util.Arrays.stream(p.getInventory().getStorageContents())
                        .anyMatch(
                            i ->
                                i != null
                                    && runner.items().owns(i)
                                    && (i.getType() == Material.BOW
                                        || i.getType() == Material.CROSSBOW)))
                      runner.items().give(p, Material.ARROW, 32);
                  });
      case DOUBLE_EMERALDS -> buffs.put(drop, now.plusSeconds(30));
      case INSTA_KILL -> buffs.put(drop, now.plusSeconds(15));
      case NUKE -> runner.combat().nuke();
      case CARPENTER -> {
        runner.map().repairAll();
        runner.fighters().forEach(p -> SurvivalItems.heal(p, 4));
      }
    }
    runner
        .online()
        .forEach(
            p -> {
              var sound =
                  switch (drop) {
                    case MAX_AMMO -> org.bukkit.Sound.ITEM_ARMOR_EQUIP_IRON;
                    case DOUBLE_EMERALDS -> org.bukkit.Sound.ENTITY_EXPERIENCE_ORB_PICKUP;
                    case INSTA_KILL -> org.bukkit.Sound.ENTITY_WITHER_SPAWN;
                    case NUKE -> org.bukkit.Sound.ENTITY_GENERIC_EXPLODE;
                    case CARPENTER -> org.bukkit.Sound.BLOCK_ANVIL_USE;
                  };
              p.playSound(Places.at(p), sound, .65f, 1.2f);
              Texts.info(p, name(drop) + " · " + effect(drop));
              runner.hud().hint(p, name(drop) + " · " + effect(drop), 4);
            });
    clear();
  }

  private void clear() {
    if (display != null) display.remove();
    if (label != null) label.remove();
    display = null;
    label = null;
    kind = null;
  }

  void reset() {
    clear();
    buffs.clear();
    nextDrop = Instant.MIN;
  }
}
