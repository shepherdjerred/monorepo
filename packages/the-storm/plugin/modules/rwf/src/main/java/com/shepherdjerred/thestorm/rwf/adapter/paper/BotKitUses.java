package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.app.ActionRefusal;
import com.shepherdjerred.thestorm.rwf.app.KitUse;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityInput;
import com.shepherdjerred.thestorm.rwf.domain.ability.ExpansionInput;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Medic;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Warper;
import java.util.Optional;
import org.bukkit.Location;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;

/**
 * A kit item used by a bot, which never clicks: each item becomes the same ability input a player's
 * click on it does, through the same listener code where there is some. Blocks are put down at the
 * bot's feet, a barricade two blocks ahead of it, and a hook lands where the bot aimed. Native
 * items (a shield, a wind charge, an ender pearl) go through the server's own item use, thrown
 * along the bot's look. Main thread only.
 */
final class BotKitUses {

  /** How far ahead of a bot its barricade goes up. */
  static final double BARRICADE_AHEAD = 2;

  private final MatchRunner runner;
  private final KitListener clicks;
  private final KitWorldListener world;
  private final TeleporterMenus teleporters;

  BotKitUses(
      MatchRunner runner, KitListener clicks, KitWorldListener world, TeleporterMenus teleporters) {
    this.runner = runner;
    this.clicks = clicks;
    this.world = world;
    this.teleporters = teleporters;
  }

  /** {@code bot}, a {@code kit}, uses {@code item} as {@code use} says. */
  Optional<ActionRefusal> use(Player bot, String kit, ItemStack item, KitUse use) {
    return switch (item.getType()) {
      case BUNDLE, CALIBRATED_SCULK_SENSOR, GRAY_DYE, GOAT_HORN ->
          act(bot, runner.powers().tactical().input(bot, item.getType()).orElseThrow());
      case FEATHER ->
          act(
              bot,
              new ExpansionInput.AirJump(!((Entity) bot).isOnGround(), bot.getVelocity().getY()));
      case SPLASH_POTION -> act(bot, new ExpansionInput.ThrowFlask());
      case SHIELD, WIND_CHARGE, ENDER_PEARL -> {
        PaperNativeItems.start(bot);
        yield Optional.empty();
      }
      default -> legacy(bot, kit, item, use);
    };
  }

  private Optional<ActionRefusal> legacy(Player bot, String kit, ItemStack item, KitUse use) {
    return switch (item.getType()) {
      case BLAZE_ROD -> wand(bot, kit, use);
      case EGG -> act(bot, new AbilityInput.LaunchRpg());
      case FIREWORK_STAR -> act(bot, new AbilityInput.ThrowGrenade());
      case QUARTZ -> {
        clicks.creator(bot, below(bot), BlockFace.UP);
        yield Optional.empty();
      }
      case STONE_PRESSURE_PLATE -> atFeet(bot, new AbilityInput.PlaceMine(Places.pos(feet(bot))));
      case WHITE_BANNER -> atFeet(bot, new AbilityInput.PlantBanner(Places.pos(feet(bot))));
      case SPYGLASS -> act(bot, new AbilityInput.Spot(world.seen(bot)));
      case FISHING_ROD ->
          use.at().isEmpty()
              ? Optional.of(ActionRefusal.OUT_OF_REACH)
              : act(bot, new AbilityInput.Grapple(use.at().orElseThrow()));
      case BRICKS ->
          act(
              bot,
              new AbilityInput.Barricade(
                  KitWorldListener.wall(
                      bot, ahead(bot).getRelative(BlockFace.DOWN), BlockFace.UP)));
      case ARMOR_STAND ->
          act(bot, new AbilityInput.Decoy(Places.vec(Places.at(bot).getDirection().setY(0))));
      case SHEARS -> act(bot, new AbilityInput.Sever());
      case RED_DYE -> bond(bot, use);
      case MAP -> remote(bot, use);
      default -> Optional.of(ActionRefusal.NO_KIT_ITEM);
    };
  }

  /** A Medic waves its wand where it stands; a Warper's wand needs an enemy in reach. */
  private Optional<ActionRefusal> wand(Player bot, String kit, KitUse use) {
    if (Medic.ID.equals(kit)) {
      clicks.heal(bot, Places.at(bot));
      return Optional.empty();
    }
    if (!Warper.ID.equals(kit)) {
      return Optional.of(ActionRefusal.NO_KIT_ITEM);
    }
    var target = use.target().flatMap(runner::entity);
    if (target.isEmpty()
        || Places.at(target.orElseThrow()).distance(Places.at(bot)) > PaperCombatantActions.REACH) {
      return Optional.of(ActionRefusal.OUT_OF_REACH);
    }
    clicks.warp(bot, target.orElseThrow());
    return Optional.empty();
  }

  /** A Sacrificial's magic on the ally it touches, as a player's click on them. */
  private Optional<ActionRefusal> bond(Player bot, KitUse use) {
    var ally = use.target().flatMap(runner::entity);
    if (ally.isEmpty()
        || Places.at(ally.orElseThrow()).distance(Places.at(bot))
            > PaperCombatantActions.MELEE_REACH) {
      return Optional.of(ActionRefusal.OUT_OF_REACH);
    }
    return act(bot, new AbilityInput.Bond(use.target().orElseThrow()));
  }

  /** A Teleporter's remote on a teammate, as a player's pick in the remote's menu. */
  private Optional<ActionRefusal> remote(Player bot, KitUse use) {
    if (use.target().isEmpty()) {
      return Optional.of(ActionRefusal.OUT_OF_REACH);
    }
    return teleporters.establish(bot, use.target().orElseThrow())
        ? Optional.empty()
        : Optional.of(ActionRefusal.OUT_OF_REACH);
  }

  private Optional<ActionRefusal> atFeet(Player bot, AbilityInput input) {
    if (!feet(bot).getType().isAir() || !below(bot).getType().isSolid()) {
      return Optional.of(ActionRefusal.OUT_OF_REACH);
    }
    return act(bot, input);
  }

  private Optional<ActionRefusal> act(Player bot, AbilityInput input) {
    return runner.kits().act(bot, input).map(ActionRefusal::of);
  }

  private static Block feet(Player bot) {
    return Places.at(bot).getBlock();
  }

  private static Block below(Player bot) {
    return feet(bot).getRelative(BlockFace.DOWN);
  }

  private static Block ahead(Player bot) {
    Location at = Places.at(bot);
    var forward = at.getDirection().setY(0);
    if (forward.lengthSquared() > 0) {
      forward.normalize().multiply(BARRICADE_AHEAD);
    }
    return at.add(forward).getBlock();
  }
}
