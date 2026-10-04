package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.domain.survival.PurchaseConfirmation;
import com.shepherdjerred.thestorm.arena.domain.survival.SurvivalClass;
import com.shepherdjerred.thestorm.arena.domain.survival.SurvivalContent;
import com.shepherdjerred.thestorm.arena.domain.survival.SurvivalPerk;
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

  private final SurvivalRunner runner;
  private final PurchaseConfirmation purchases = new PurchaseConfirmation();
  private final Map<UUID, Integer> selfPurchases = new HashMap<>();
  private final Map<UUID, Set<SurvivalPerk>> perks = new HashMap<>();

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
      runner.feedback().play(player, SurvivalFeedback.Cue.CRAFT);
    }
  }

  void unlock(
      Player player,
      SurvivalContent.Zone zone,
      com.shepherdjerred.thestorm.arena.domain.geometry.BlockPos sign) {
    if (!runner.map().state().unlockable(zone)) {
      Texts.error(player, "Open the connecting routes first, or this route is already open.");
      return;
    }
    if (!purchases.confirm(
        player.getUniqueId(), sign.toString(), runner.context().time().instant())) {
      runner.feedback().play(player, SurvivalFeedback.Cue.CONFIRM);
      Texts.info(
          player,
          zone.name()
              + " costs "
              + zone.emeralds()
              + " emeralds. Click this sign again within three seconds.");
      return;
    }
    if (runner.items().spend(player, Map.of("EMERALD", zone.emeralds()))) {
      runner.map().unlock(zone);
      runner.feedback().play(player, SurvivalFeedback.Cue.UNLOCK);
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
    runner.feedback().play(player, SurvivalFeedback.Cue.CRAFT);
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
      runner.feedback().play(player, SurvivalFeedback.Cue.FAILURE);
      return;
    }
    items.give(player, material, resource.amount());
    runner.feedback().play(player, SurvivalFeedback.Cue.GATHER);
    Texts.info(player, "Gathered " + resource.amount() + " " + resource.material() + ".");
  }

  boolean has(Player player, SurvivalPerk perk) {
    return perks.getOrDefault(player.getUniqueId(), Set.of()).contains(perk);
  }

  String perks(Player player) {
    return perks.getOrDefault(player.getUniqueId(), Set.of()).toString();
  }

  void perk(Player player, SurvivalPerk perk) {
    var id = player.getUniqueId();
    var owned = perks.computeIfAbsent(id, _ -> new HashSet<>());
    if (owned.contains(perk)) {
      Texts.info(player, "You already have that perk.");
      return;
    }
    var solo = runner.game().participants().size() == 1;
    if (perk == SurvivalPerk.QUICK_REVIVE
        && solo
        && (selfPurchases.getOrDefault(id, 0) >= 2
            || runner.game().player(id).orElseThrow().selfRevive())) {
      Texts.info(player, "Use your existing self-revive first. At most two extra charges per run.");
      return;
    }
    if (!runner.items().spend(player, Map.of("EMERALD", perk.price()))) return;
    owned.add(perk);
    if (perk == SurvivalPerk.QUICK_REVIVE && solo) {
      if (!runner.game().purchaseSelfRevive(id))
        throw new IllegalStateException("Self-revive purchase rejected");
      selfPurchases.merge(id, 1, Integer::sum);
    }
    applyPerks(player);
    runner.feedback().perk(player, perk);
    Texts.info(player, "Purchased " + perk + ". Perks are lost when downed.");
  }

  void applyPerks(Player player) {
    if (has(player, SurvivalPerk.JUGGERNOG))
      player.addPotionEffect(
          new PotionEffect(PotionEffectType.HEALTH_BOOST, PotionEffect.INFINITE_DURATION, 1));
    if (has(player, SurvivalPerk.STAMIN_UP))
      player.addPotionEffect(
          new PotionEffect(PotionEffectType.SPEED, PotionEffect.INFINITE_DURATION, 0));
  }

  void losePerks(Player player) {
    perks.remove(player.getUniqueId());
    player.removePotionEffect(PotionEffectType.SPEED);
    player.removePotionEffect(PotionEffectType.HEALTH_BOOST);
    if (player.getHealth() > 20) player.setHealth(20);
  }

  void leave(UUID id) {
    perks.remove(id);
    purchases.remove(id);
    selfPurchases.remove(id);
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
    runner.talents().ability(player);
  }
}
