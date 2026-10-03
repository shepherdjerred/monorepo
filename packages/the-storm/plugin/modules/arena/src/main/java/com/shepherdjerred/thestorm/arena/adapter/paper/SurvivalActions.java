package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.domain.survival.SurvivalClass;
import com.shepherdjerred.thestorm.arena.domain.survival.SurvivalContent;
import java.time.Instant;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;

/** Purchases, explicitly donated resources and modest class abilities. Main thread only. */
final class SurvivalActions {
  enum Perk {
    VITALITY,
    SWIFTNESS,
    HARDENED
  }

  private final SurvivalRunner runner;
  private final Map<UUID, Instant> cooldowns = new HashMap<>();
  private final Map<UUID, Set<Perk>> perks = new HashMap<>();

  SurvivalActions(SurvivalRunner runner) {
    this.runner = runner;
  }

  void craft(Player player, SurvivalContent.Recipe recipe) {
    var items = runner.items();
    var material = SurvivalItems.material(recipe.material());
    if (items.fits(player, material, recipe.amount())
        && items.spend(player, recipe.ingredients())) {
      items.give(player, material, recipe.amount());
      Texts.info(player, "Crafted " + recipe.name() + ".");
    }
  }

  void unlock(Player player, SurvivalContent.Zone zone) {
    if (!runner.map().state().unlockable(zone)) {
      Texts.error(player, "Open the connecting routes first, or this route is already open.");
      return;
    }
    if (runner.items().spend(player, Map.of("EMERALD", zone.emeralds()))) {
      runner.map().unlock(zone);
      runner
          .online()
          .forEach(
              p ->
                  Texts.info(
                      p,
                      player.getName()
                          + " opened "
                          + zone.name()
                          + ". New enemy entrances are active."));
    }
  }

  void repair(Player player, SurvivalContent.Defense defense) {
    var barricade = defense.type() == SurvivalContent.DefenseType.BARRICADE;
    if (runner.map().state().strength(defense.id()) >= (barricade ? 5 : 1)) {
      Texts.info(player, "This defense is ready.");
      return;
    }
    var role = runner.game().player(player.getUniqueId()).orElseThrow().role();
    var cost =
        barricade
            ? Map.of("OAK_PLANKS", role == SurvivalClass.ENGINEER ? 2 : 4)
            : Map.of("IRON_INGOT", 2, "REDSTONE", 2);
    if (!runner.items().spend(player, cost)) {
      return;
    }
    if (barricade) {
      runner.map().state().repair(defense.id());
      runner.map().barricade(defense, Material.OAK_FENCE);
    } else {
      runner.map().arm(defense, player.getUniqueId());
    }
    Texts.info(player, barricade ? "Barricade repaired." : "Trap charged for one activation.");
  }

  void gather(Player player, SurvivalContent.Resource resource) {
    var items = runner.items();
    var material = SurvivalItems.material(resource.material());
    if (!items.fits(player, material, resource.amount())) {
      Texts.error(player, "Make room first.");
      return;
    }
    if (!runner.map().state().harvest(player.getUniqueId(), resource)) {
      Texts.info(player, "Depleted for you this round.");
      return;
    }
    items.give(player, material, resource.amount());
    Texts.info(player, "Gathered " + resource.amount() + " " + resource.material() + ".");
  }

  void perk(Player player, Perk perk) {
    var owned = perks.computeIfAbsent(player.getUniqueId(), _ -> new HashSet<>());
    if (owned.contains(perk)) {
      Texts.info(player, "You already have that perk.");
      return;
    }
    if (runner.items().spend(player, Map.of("EMERALD", 30))) {
      owned.add(perk);
      applyPerks(player);
      Texts.info(player, "Purchased " + perk + " for this run.");
    }
  }

  void applyPerks(Player player) {
    for (var perk : perks.getOrDefault(player.getUniqueId(), Set.of())) {
      var type =
          switch (perk) {
            case VITALITY -> PotionEffectType.HEALTH_BOOST;
            case SWIFTNESS -> PotionEffectType.SPEED;
            case HARDENED -> PotionEffectType.RESISTANCE;
          };
      player.addPotionEffect(new PotionEffect(type, PotionEffect.INFINITE_DURATION, 0));
    }
  }

  void donate(Player source, Player target, Material material, int amount) {
    if (!runner.isFighter(source.getUniqueId())
        || !runner.isFighter(target.getUniqueId())
        || source.equals(target)
        || amount < 1
        || amount > 64
        || Places.at(source).distanceSquared(Places.at(target)) > 64) {
      Texts.error(source, "Donate 1–64 items to a standing teammate within eight blocks.");
      return;
    }
    if (!runner.items().fits(target, material, amount)) {
      Texts.error(source, "Your teammate's inventory is full.");
      return;
    }
    if (runner.items().spend(source, Map.of(material.name(), amount))) {
      runner.items().give(target, material, amount);
      Texts.info(source, "Donated " + amount + " " + material + " to " + target.getName() + ".");
      Texts.info(target, source.getName() + " donated " + amount + " " + material + ".");
    }
  }

  void ability(Player player) {
    if (!runner.isFighter(player.getUniqueId())) {
      Texts.error(player, "Use your ability while standing in a run.");
      return;
    }
    var now = runner.context().time().instant();
    if (now.isBefore(cooldowns.getOrDefault(player.getUniqueId(), Instant.MIN))) {
      Texts.error(player, "Your ability is recharging.");
      return;
    }
    var role = runner.game().player(player.getUniqueId()).orElseThrow().role();
    switch (role) {
      case FIGHTER -> sweep(player);
      case RANGER -> {
        runner.items().give(player, Material.ARROW, 8);
        player.addPotionEffect(new PotionEffect(PotionEffectType.SPEED, 100, 1));
      }
      case MEDIC ->
          runner.fighters().stream()
              .filter(p -> Places.at(p).distanceSquared(Places.at(player)) < 64)
              .forEach(p -> SurvivalItems.heal(p, 6));
      case ENGINEER ->
          runner.map().open().stream()
              .flatMap(z -> z.defenses().stream())
              .filter(d -> d.type() == SurvivalContent.DefenseType.BARRICADE)
              .filter(
                  d ->
                      runner
                              .world()
                              .block(d.block())
                              .getLocation()
                              .distanceSquared(Places.at(player))
                          < 64)
              .findFirst()
              .ifPresent(
                  d -> {
                    runner.map().state().repair(d.id());
                    runner.map().barricade(d, Material.OAK_FENCE);
                  });
      case ALCHEMIST ->
          runner.world().enemies().stream()
              .filter(e -> e.getLocation().distanceSquared(Places.at(player)) < 100)
              .forEach(
                  e -> {
                    e.addPotionEffect(new PotionEffect(PotionEffectType.SLOWNESS, 120, 1));
                    e.addPotionEffect(new PotionEffect(PotionEffectType.WEAKNESS, 120, 0));
                  });
      case BEASTMASTER -> {
        runner.world().removeWolves(player.getUniqueId());
        runner.world().spawnWolves(player, 1);
      }
    }
    cooldowns.put(player.getUniqueId(), now.plusSeconds(40));
    Texts.info(player, role + " ability used. Recharges in 40 seconds.");
  }

  private void sweep(Player player) {
    runner.world().enemies().stream()
        .filter(e -> e.getLocation().distanceSquared(Places.at(player)) < 25)
        .forEach(
            e -> {
              runner.combat().hit(e, player);
              e.damage(4, player);
              var push = e.getLocation().toVector().subtract(Places.at(player).toVector());
              if (push.lengthSquared() > 0.01) {
                e.setVelocity(push.normalize().multiply(0.8).setY(0.3));
              }
            });
  }
}
