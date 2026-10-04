package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.arena.domain.survival.DebugPreset;
import com.shepherdjerred.thestorm.arena.domain.survival.PlaneQuest;
import com.shepherdjerred.thestorm.arena.domain.survival.SurvivalContent;
import com.shepherdjerred.thestorm.arena.domain.survival.SurvivalPerk;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.bukkit.Material;
import org.bukkit.Particle;
import org.bukkit.entity.Player;

/** Physical Zombies machines and optional, individual plane trips while combat keeps running. */
final class ZombiesMachines {
  private record Boarding(Instant due, boolean returning, org.bukkit.Location from) {}

  private final SurvivalRunner runner;
  private final PlaneQuest quest;
  private final Map<UUID, Boarding> boarding = new HashMap<>();
  private Instant boardingWindow = Instant.MIN;
  private boolean departed;

  ZombiesMachines(SurvivalRunner runner) {
    this.runner = runner;
    quest =
        new PlaneQuest(
            runner.map().content().planeParts().stream()
                .map(SurvivalContent.PlanePart::id)
                .collect(Collectors.toUnmodifiableSet()));
  }

  boolean powered() {
    return quest.powered();
  }

  boolean travelling(UUID id) {
    return boarding.containsKey(id);
  }

  String status(UUID id) {
    return "Plane "
        + quest.installed()
        + "/5"
        + (quest.flown() ? " fuel " + quest.fuel() + "/5" : "")
        + quest.carried(id).map(part -> " · Carrying " + part).orElse("")
        + (powered() ? " · Power ON" : " · Power OFF");
  }

  void debug(int round) {
    var preset = DebugPreset.at(round);
    if (preset.powered()) quest.power();
    if (preset.assembled()) quest.debugComplete();
  }

  boolean interact(Player player, BlockPos pos) {
    var content = runner.map().content();
    var part = content.planeParts().stream().filter(p -> p.block().equals(pos)).findFirst();
    if (part.isPresent()) {
      if (quest.take(player.getUniqueId(), part.orElseThrow().id()))
        Texts.info(
            player,
            "Carrying " + part.orElseThrow().name() + ". Install it at the airstrip workbench.");
      else Texts.info(player, "This part is taken, installed, or you already carry a part.");
      return true;
    }
    if (content.planeWorkbench().equals(pos)) {
      if (quest.install(player.getUniqueId())) {
        Texts.info(player, "Installed cargo. " + status(player.getUniqueId()));
      } else board(player, false);
      return true;
    }
    if (content.expedition().returnSign().equals(pos)) {
      board(player, true);
      return true;
    }
    var machine = runner.map().machine(pos);
    if (machine.isEmpty()) return false;
    use(player, machine.orElseThrow().type());
    return true;
  }

  private void use(Player player, SurvivalContent.MachineType type) {
    if (type == SurvivalContent.MachineType.FOOD) {
      buyFood(player);
      return;
    }
    if (type == SurvivalContent.MachineType.POWER) {
      if (powered()) {
        Texts.info(player, "Power is already on.");
        return;
      }
      if (runner.items().spend(player, Map.of("IRON_INGOT", 4, "REDSTONE", 4))) {
        quest.power();
        runner
            .online()
            .forEach(
                p ->
                    Texts.info(
                        p, "The fortress has power. Perks, mystery box and the forge are active."));
      }
      return;
    }
    if (!powered() && type != SurvivalContent.MachineType.QUICK_REVIVE) {
      Texts.error(player, "Restore power at the foundry: four iron and four redstone.");
      return;
    }
    switch (type) {
      case JUGGERNOG, STAMIN_UP, DOUBLE_TAP, QUICK_REVIVE ->
          runner.actions().perk(player, SurvivalPerk.valueOf(type.name()));
      case MYSTERY_BOX -> mystery(player);
      case PACK_A_PUNCH -> punch(player);
      case FOOD, POWER -> throw new IllegalStateException("Machine already handled");
    }
  }

  private void buyFood(Player player) {
    if (runner.items().fits(player, Material.BREAD, 3)
        && runner.items().spend(player, Map.of("EMERALD", 2))) {
      runner.items().give(player, Material.BREAD, 3);
      Texts.info(player, "Bought three bread for two emeralds.");
    }
  }

  private void mystery(Player player) {
    var material = mysteryWeapon(runner.context().random().nextInt(100));
    var ranged = material == Material.BOW || material == Material.CROSSBOW;
    var inventory = player.getInventory();
    var free =
        java.util.Arrays.stream(inventory.getStorageContents())
            .filter(i -> i == null || i.isEmpty())
            .count();
    if (free < (ranged ? 2 : 1)) {
      Texts.error(player, "Make room for a weapon and its ammunition.");
      return;
    }
    if (!runner.items().spend(player, Map.of("EMERALD", 16))) return;
    var weapon = runner.items().stack(material, 1);
    if (material == Material.BOW)
      weapon.addEnchantment(org.bukkit.enchantments.Enchantment.POWER, 1);
    inventory.addItem(weapon);
    if (ranged) runner.items().give(player, Material.ARROW, 32);
    Texts.info(player, "Mystery box: " + material + ".");
  }

  private static Material mysteryWeapon(int roll) {
    if (roll < 40) return Material.IRON_SWORD;
    if (roll < 65) return Material.BOW;
    if (roll < 85) return Material.CROSSBOW;
    if (roll < 95) return Material.DIAMOND_SWORD;
    return Material.TRIDENT;
  }

  private void punch(Player player) {
    var weapon = player.getInventory().getItemInMainHand();
    var tier = runner.items().tier(weapon);
    if (!runner.items().weapon(weapon) || tier >= 3) {
      Texts.error(player, "Hold a run weapon with fewer than three upgrades.");
      return;
    }
    if (runner.items().spend(player, Map.of("EMERALD", 36 * (tier + 1)))) {
      runner.items().upgrade(weapon, tier + 1);
      player.getInventory().setItemInMainHand(weapon);
      Texts.info(player, "Weapon upgraded and repaired to Pack-a-Punch " + (tier + 1) + ".");
    }
  }

  private void board(Player player, boolean returning) {
    var now = runner.context().time().instant();
    var id = player.getUniqueId();
    if (travelling(id)) return;
    var onIsland =
        runner.map().content().expedition().area().contains(Places.point(Places.at(player)));
    if (returning != onIsland) {
      Texts.error(player, "Use the departure point on this shore.");
      return;
    }
    if (!returning && !now.isBefore(boardingWindow)) {
      if (!quest.ready(runner.game().round())) {
        Texts.info(
            player,
            "Plane needs power, five installed parts, then five fuel pickups and one cleared round between trips.");
        return;
      }
      boardingWindow = now.plusSeconds(5);
      departed = false;
    }
    boarding.put(id, new Boarding(now.plusSeconds(5), returning, Places.at(player).clone()));
    Texts.info(player, "Boarding in five seconds. Stay nearby; rounds continue during your trip.");
  }

  void tick() {
    var now = runner.context().time().instant();
    for (var entry : java.util.List.copyOf(boarding.entrySet())) {
      var player = runner.context().server().getPlayer(entry.getKey());
      var trip = entry.getValue();
      if (player == null
          || runner.downed(entry.getKey())
          || trip.from().distanceSquared(Places.at(player)) > 16) {
        boarding.remove(entry.getKey());
        continue;
      }
      player
          .getWorld()
          .spawnParticle(Particle.CLOUD, Places.at(player).add(0, 1, 0), 12, .4, .2, .4, .02);
      runner
          .hud()
          .hint(
              player,
              "Boarding · "
                  + Math.max(0, java.time.Duration.between(now, trip.due()).toSeconds())
                  + "s",
              2);
      if (now.isBefore(trip.due())) continue;
      arrive(entry.getKey(), trip, player);
    }
  }

  private void arrive(UUID id, Boarding trip, Player player) {
    if (!trip.returning() && !departed) {
      if (!quest.depart(runner.game().round()))
        throw new IllegalStateException("Plane departure lost its completed requirements");
      departed = true;
    }
    boarding.remove(id);
    runner.map().visit(id, !trip.returning());
    var destination =
        trip.returning()
            ? runner.map().content().expedition().returnTo()
            : runner.map().content().expedition().arrival();
    player.teleport(Places.location(runner.world().world(), destination));
    player.setFallDistance(0);
    player.setVelocity(new org.bukkit.util.Vector());
    player.setNoDamageTicks(40);
    Texts.info(
        player,
        trip.returning()
            ? "Back at the fortress."
            : "Offshore forge: Pack-a-Punch your held weapon, then use the return sign.");
  }

  void interrupt(UUID id) {
    boarding.remove(id);
  }

  void leave(UUID id) {
    boarding.remove(id);
    quest.leave(id);
    runner.map().visit(id, false);
  }
}
