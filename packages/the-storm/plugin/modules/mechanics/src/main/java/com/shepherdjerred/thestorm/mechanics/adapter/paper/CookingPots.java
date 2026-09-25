package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import com.shepherdjerred.thestorm.mechanics.domain.sign.Feature;
import com.shepherdjerred.thestorm.mechanics.domain.tools.CookingPot;
import java.util.Optional;
import org.bukkit.block.Sign;
import org.bukkit.block.data.Lightable;
import org.bukkit.entity.Player;
import org.bukkit.inventory.CookingRecipe;
import org.bukkit.inventory.ItemStack;

/**
 * Cooking pots. Right-clicking with fuel adds fuel; right-clicking with anything a furnace, smoker
 * or campfire can cook cooks the held stack, one fuel unit per item, straight into the player's
 * inventory.
 */
final class CookingPots {

  private final Kit kit;

  CookingPots(Kit kit) {
    this.kit = kit;
  }

  void click(Player player, PaperGrid grid, Pos signPos, Sign sign) {
    var config = kit.config().cookingPot();
    var heat = CookingPot.heatSource(grid, signPos, config);
    var lit =
        heat.map(pos -> grid.block(pos).getBlockData())
            .map(data -> !(data instanceof Lightable lightable) || lightable.isLit())
            .orElse(false);
    if (!lit) {
      Replies.error(player, Feature.COOKING_POT, "The fire under the pot is out.");
      return;
    }
    var held = player.getInventory().getItemInMainHand();
    var fuel = kit.signs().fuel(sign);
    if (held.isEmpty()) {
      Replies.info(
          player, Feature.COOKING_POT, "The pot has " + fuel + " fuel. Right-click with food.");
      return;
    }
    var units = config.fuels().get(PaperGrid.key(held.getType()));
    if (units != null) {
      refuel(player, sign, held, units);
      return;
    }
    cook(player, sign, held);
  }

  private void refuel(Player player, Sign sign, ItemStack held, int unitsEach) {
    var before = kit.signs().fuel(sign);
    var refuel =
        CookingPot.refuel(
            before,
            new CookingPot.Offer(held.getAmount(), unitsEach),
            kit.config().cookingPot().maxFuel());
    if (refuel.itemsTaken() == 0) {
      Replies.error(player, Feature.COOKING_POT, "The pot is full of fuel.");
      return;
    }
    held.subtract(refuel.itemsTaken());
    kit.signs().setFuel(sign, refuel.fuel());
    sign.update();
    Replies.success(player, Feature.COOKING_POT, "The pot has " + refuel.fuel() + " fuel.");
  }

  private void cook(Player player, Sign sign, ItemStack held) {
    var recipe = recipeFor(player, held);
    if (recipe.isEmpty()) {
      Replies.error(player, Feature.COOKING_POT, "That can't be cooked.");
      return;
    }
    var cook = CookingPot.cook(kit.signs().fuel(sign), held.getAmount());
    if (cook.cooked() == 0) {
      Replies.error(player, Feature.COOKING_POT, "The pot needs fuel first.");
      return;
    }
    var found = recipe.orElseThrow();
    held.subtract(cook.cooked());
    kit.signs().setFuel(sign, cook.fuel());
    sign.update();
    var result = found.getResult();
    Items.give(player, result, (long) result.getAmount() * cook.cooked());
    player.giveExp(Math.round(found.getExperience() * cook.cooked()));
    Replies.success(
        player,
        Feature.COOKING_POT,
        "Cooked " + cook.cooked() + "; " + cook.fuel() + " fuel left.");
  }

  private static Optional<CookingRecipe<?>> recipeFor(Player player, ItemStack held) {
    var one = held.asOne();
    for (var recipes = player.getServer().recipeIterator(); recipes.hasNext(); ) {
      if (recipes.next() instanceof CookingRecipe<?> cooking
          && cooking.getInputChoice().test(one)) {
        return Optional.of(cooking);
      }
    }
    return Optional.empty();
  }
}
