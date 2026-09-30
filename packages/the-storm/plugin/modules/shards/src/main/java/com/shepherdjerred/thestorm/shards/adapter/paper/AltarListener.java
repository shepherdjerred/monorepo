package com.shepherdjerred.thestorm.shards.adapter.paper;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.core.text.HouseStyle;
import com.shepherdjerred.thestorm.shards.domain.AltarSky;
import com.shepherdjerred.thestorm.shards.domain.Altars;
import com.shepherdjerred.thestorm.shards.domain.BlockPos;
import com.shepherdjerred.thestorm.shards.domain.UpgradeOutcome;
import com.shepherdjerred.thestorm.shards.domain.UpgradeRefusal;
import com.shepherdjerred.thestorm.shards.domain.UpgradeRequest;
import com.shepherdjerred.thestorm.shards.domain.Upgrades;
import java.time.Duration;
import java.util.function.Function;
import net.kyori.adventure.text.minimessage.tag.resolver.Placeholder;
import net.kyori.adventure.text.minimessage.tag.resolver.TagResolver;
import org.bukkit.block.Block;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;

/**
 * The windmill ritual: right-click an altar block in the rain while holding gear, and the storm
 * spends shards from your inventory to upgrade it. The whole attempt runs synchronously inside the
 * event, so the item and shards cannot change between the check and the result.
 */
final class AltarListener implements Listener {

  private static final Duration BOLT_INTERVAL = Duration.ofSeconds(1);

  private final Altars altars;
  private final Upgrades upgrades;
  private final Scheduler scheduler;
  private final Function<Block, AltarSky> sky;
  private final ShardKit kit;

  AltarListener(AltarSetup setup, ShardKit kit) {
    this.altars = setup.altars();
    this.upgrades = setup.upgrades();
    this.scheduler = setup.scheduler();
    this.sky = setup.sky();
    this.kit = kit;
  }

  /**
   * Any right-click on an altar is cancelled, from either hand, so nothing can be placed on it or
   * used through it. Only the main hand attempts an upgrade, at most once per player per cooldown
   * window, claimed before anything is read or spent.
   */
  @EventHandler(priority = EventPriority.HIGH)
  void onInteract(PlayerInteractEvent event) {
    var block = event.getClickedBlock();
    if (event.getAction() != Action.RIGHT_CLICK_BLOCK || block == null || !isAltar(block)) {
      return;
    }
    event.setCancelled(true);
    var player = event.getPlayer();
    if (event.getHand() != EquipmentSlot.HAND
        || !altars.tryAttempt(player.getUniqueId(), kit.time().instant())) {
      return;
    }
    var item = player.getInventory().getItemInMainHand();
    var request =
        new UpgradeRequest(
            kit.gear().categoryOf(item),
            kit.gear().tierOf(item),
            kit.shards().count(player.getInventory()),
            sky.apply(block).raining());
    switch (upgrades.attempt(request, kit.random())) {
      case Result.Ok<UpgradeOutcome, UpgradeRefusal>(var outcome) ->
          resolve(player, item, block, outcome);
      case Result.Err<UpgradeOutcome, UpgradeRefusal>(var refusal) -> refuse(player, refusal);
    }
  }

  private boolean isAltar(Block block) {
    var position =
        new BlockPos(
            block.getWorld().getKey().asString(), block.getX(), block.getY(), block.getZ());
    return altars.isAltar(position, block.getType().name());
  }

  private void refuse(Player player, UpgradeRefusal refusal) {
    var messages = kit.text().messages();
    switch (refusal) {
      case UpgradeRefusal.NotUpgradeable() -> kit.text().error(player, messages.notUpgradeable());
      case UpgradeRefusal.AtMaxTier() -> kit.text().error(player, messages.atMaxTier());
      case UpgradeRefusal.NoStorm() -> kit.text().error(player, messages.noStorm());
      case UpgradeRefusal.NotEnoughShards(var tier, var needed, var held) ->
          kit.text()
              .error(
                  player,
                  messages.notEnoughShards(),
                  ShardText.tier(tier),
                  ShardText.number("needed", needed),
                  ShardText.number("held", held));
    }
  }

  private void resolve(Player player, ItemStack item, Block altar, UpgradeOutcome outcome) {
    kit.shards().take(player.getInventory(), outcome.shardsSpent());
    var messages = kit.text().messages();
    var itemName = ShardText.itemName(item);
    var tier = ShardText.tier(outcome.tier());
    switch (outcome) {
      case UpgradeOutcome.Upgraded(var reached, _) -> {
        kit.gear().apply(item, reached);
        player.getInventory().setItemInMainHand(item);
        kit.text().success(player, messages.upgraded(), itemName, tier);
        strikeLightning(altar, Upgrades.lightningStrikes(reached));
        if (upgrades.broadcasts(reached)) {
          announce(player, itemName, tier);
        }
      }
      case UpgradeOutcome.Failed _ -> kit.text().error(player, messages.failed(), itemName, tier);
      case UpgradeOutcome.Shattered _ -> {
        player.getInventory().setItemInMainHand(null);
        kit.text().error(player, messages.shattered(), itemName, tier);
        strikeLightning(altar, 1);
      }
    }
  }

  private void announce(Player player, TagResolver itemName, TagResolver tier) {
    player
        .getServer()
        .broadcast(
            HouseStyle.info(
                ShardText.BROADCAST_LABEL,
                ShardText.render(
                    kit.text().messages().broadcast(),
                    Placeholder.unparsed("player", player.getName()),
                    itemName,
                    tier)));
  }

  /** Harmless bolts on the altar, a second apart, like the original windmill. */
  private void strikeLightning(Block altar, int bolts) {
    var location = altar.getLocation().toCenterLocation();
    for (var bolt = 0; bolt < bolts; bolt++) {
      scheduler.runOnMainThreadLater(
          BOLT_INTERVAL.multipliedBy(bolt),
          () -> location.getWorld().strikeLightningEffect(location));
    }
  }
}
