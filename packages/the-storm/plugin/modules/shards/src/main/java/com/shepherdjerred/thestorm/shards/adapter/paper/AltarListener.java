package com.shepherdjerred.thestorm.shards.adapter.paper;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.core.text.HouseStyle;
import com.shepherdjerred.thestorm.shards.domain.AltarLocation;
import com.shepherdjerred.thestorm.shards.domain.AltarSky;
import com.shepherdjerred.thestorm.shards.domain.StormTier;
import com.shepherdjerred.thestorm.shards.domain.UpgradeOutcome;
import com.shepherdjerred.thestorm.shards.domain.UpgradeRefusal;
import com.shepherdjerred.thestorm.shards.domain.UpgradeRequest;
import com.shepherdjerred.thestorm.shards.domain.Upgrades;
import java.time.Duration;
import java.util.List;
import net.kyori.adventure.text.minimessage.tag.resolver.Placeholder;
import net.kyori.adventure.text.minimessage.tag.resolver.TagResolver;
import org.bukkit.World;
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

  private final List<AltarLocation> altars;
  private final Upgrades upgrades;
  private final ShardKit kit;
  private final Scheduler scheduler;

  AltarListener(List<AltarLocation> altars, Upgrades upgrades, ShardKit kit, Scheduler scheduler) {
    this.altars = List.copyOf(altars);
    this.upgrades = upgrades;
    this.kit = kit;
    this.scheduler = scheduler;
  }

  @EventHandler(priority = EventPriority.HIGH)
  void onInteract(PlayerInteractEvent event) {
    var block = event.getClickedBlock();
    if (event.getAction() != Action.RIGHT_CLICK_BLOCK
        || event.getHand() != EquipmentSlot.HAND
        || block == null
        || !isAltar(block)) {
      return;
    }
    event.setCancelled(true);
    var player = event.getPlayer();
    var item = player.getInventory().getItemInMainHand();
    var request =
        new UpgradeRequest(
            kit.gear().categoryOf(item),
            kit.gear().tierOf(item),
            kit.shards().count(player.getInventory()),
            skyOver(block).raining());
    switch (upgrades.attempt(request, kit.random())) {
      case Result.Ok<UpgradeOutcome, UpgradeRefusal>(var outcome) ->
          resolve(player, item, block, outcome);
      case Result.Err<UpgradeOutcome, UpgradeRefusal>(var refusal) -> refuse(player, refusal);
    }
  }

  private boolean isAltar(Block block) {
    var world = block.getWorld().getKey().asString();
    return altars.stream()
        .anyMatch(altar -> altar.isAt(world, block.getX(), block.getY(), block.getZ()));
  }

  private static AltarSky skyOver(Block block) {
    var world = block.getWorld();
    return new AltarSky(
        world.getEnvironment() == World.Environment.NORMAL,
        world.hasStorm(),
        block.getTemperature(),
        block.getHumidity());
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
    var itemName = Placeholder.component("item", item.effectiveName());
    var tier = ShardText.tier(outcome.tier());
    switch (outcome) {
      case UpgradeOutcome.Upgraded(var reached, _) -> {
        kit.gear().apply(item, reached);
        player.getInventory().setItemInMainHand(item);
        kit.text().success(player, messages.upgraded(), itemName, tier);
        strikeLightning(altar, reached);
        if (upgrades.broadcasts(reached)) {
          announce(player, itemName, tier);
        }
      }
      case UpgradeOutcome.Failed _ -> kit.text().error(player, messages.failed(), itemName, tier);
      case UpgradeOutcome.Shattered _ -> {
        player.getInventory().setItemInMainHand(null);
        kit.text().error(player, messages.shattered(), itemName, tier);
        altar.getWorld().strikeLightningEffect(altar.getLocation().toCenterLocation());
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

  /** One harmless bolt per tier, a second apart, like the original windmill. */
  private void strikeLightning(Block altar, StormTier tier) {
    var location = altar.getLocation().toCenterLocation();
    for (var bolt = 0; bolt < Upgrades.lightningStrikes(tier); bolt++) {
      scheduler.runOnMainThreadLater(
          BOLT_INTERVAL.multipliedBy(bolt),
          () -> location.getWorld().strikeLightningEffect(location));
    }
  }
}
