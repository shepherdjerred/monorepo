// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/abilities/
// TeleporterAbility.java, onInteractBlock and onBlockBreak, and
// redwarfare-core/src/me/libraryaddict/core/utils/UtilLoc.java, isLookingAt); see
// packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityInput;
import com.shepherdjerred.thestorm.rwf.domain.ability.Placed;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Teleporter;
import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.rwf.domain.match.Combatant;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.util.Vector;
import org.jspecify.annotations.Nullable;

/**
 * Right-clicks and digs on teleporter blocks, as Red Warfare took them. Every fighter's right-click
 * on a block is spaced at least 0.2 seconds apart; on a teleporter, a Teleporter holding its
 * creator breaks its own or an enemy's, and anyone else is told whose it is, at most every 0.5
 * seconds. On any other block the creator places a teleporter, its checks made in Red Warfare's
 * order. Mining a teleporter breaks it, the server's own refusal to break the block
 * notwithstanding. Main thread only.
 */
final class TeleporterClicks {

  /** Red Warfare's {@code TeleClick} recharge. */
  static final Duration CLICK = Duration.ofMillis(200);

  /** Red Warfare's {@code Tele Info} recharge. */
  static final Duration INFO = Duration.ofMillis(500);

  private final MatchRunner runner;
  private final Keys keys;
  private final Map<UUID, Instant> clicks = new HashMap<>();
  private final Map<UUID, Instant> infos = new HashMap<>();

  TeleporterClicks(MatchRunner runner, Keys keys) {
    this.runner = runner;
    this.keys = keys;
  }

  /**
   * A fighter on {@code kit} right-clicked {@code block} holding {@code item}. Returns whether the
   * item's own use goes on: the creator's only on a block that is not a teleporter, and only once
   * the click has recharged.
   */
  boolean rightClick(Player player, String kit, @Nullable ItemStack item, Block block) {
    var creator = creator(kit, item);
    if (!recharged(clicks, player.getUniqueId(), CLICK)) {
      return !creator;
    }
    var teleporter = teleporterAt(Places.pos(block));
    if (teleporter.isEmpty()) {
      return true;
    }
    touch(player, teleporter.orElseThrow(), creator);
    return !creator;
  }

  /** The Teleport Creator on {@code block}, struck on {@code face}. */
  void create(Player player, Block block, BlockFace face) {
    var pos = Places.pos(block);
    var teleporter = teleporterAt(pos);
    if (teleporter.isPresent()) {
      touch(player, teleporter.orElseThrow(), true);
      return;
    }
    var site =
        new AbilityInput.Site(
            Classic.solid(block),
            nearBomb(runner, pos),
            face == BlockFace.UP,
            lookingAt(player, block),
            valid(block));
    runner.kits().act(player, new AbilityInput.PlaceTeleporter(pos, Optional.empty(), 0, site));
  }

  /** {@code player} mined {@code block}: a teleporter there breaks. */
  void mined(Player player, Block block) {
    var pos = Places.pos(block);
    if (teleporterAt(pos).isPresent()) {
      runner.kits().act(player, new AbilityInput.BreakTeleporter(pos));
    }
  }

  /** The match reset. */
  void clear() {
    clicks.clear();
    infos.clear();
  }

  private void touch(Player player, Placed.Teleporter teleporter, boolean creator) {
    var pos = teleporter.block();
    var mine =
        runner
            .memberOf(player.getUniqueId())
            .filter(member -> member.id().equals(teleporter.owner()))
            .isPresent();
    var enemy =
        runner
            .memberOf(player.getUniqueId())
            .flatMap(Combatant::team)
            .filter(team -> team != teleporter.team())
            .isPresent();
    if (creator && (mine || enemy)) {
      runner.kits().act(player, new AbilityInput.BreakTeleporter(pos));
    } else if (recharged(infos, player.getUniqueId(), INFO)) {
      runner.kits().act(player, new AbilityInput.InspectTeleporter(pos));
    }
  }

  private boolean creator(String kit, @Nullable ItemStack item) {
    return Teleporter.ID.equals(kit)
        && item != null
        && item.getType() == Material.QUARTZ
        && keys.isKitItem(item);
  }

  /** Red Warfare's {@code Recharge.canUse} then {@code use}: whether it was ready. */
  private boolean recharged(Map<UUID, Instant> uses, UUID player, Duration length) {
    var now = runner.now();
    var last = uses.get(player);
    if (last != null && !now.isAfter(last.plus(length))) {
      return false;
    }
    uses.put(player, now);
    return true;
  }

  private Optional<Placed.Teleporter> teleporterAt(BlockPos pos) {
    return runner
        .match()
        .abilities()
        .placedAt(pos)
        .filter(Placed.Teleporter.class::isInstance)
        .map(Placed.Teleporter.class::cast);
  }

  /** Whether {@code pos} is in the column of any bomb the map placed, destroyed ones too. */
  static boolean nearBomb(MatchRunner runner, BlockPos pos) {
    return Teleporter.nearBomb(
        pos, runner.match().bombs().stream().map(bomb -> bomb.site().position()).toList());
  }

  /** Red Warfare's {@code Teleporter.isValid}: solid, with two open blocks above it. */
  static boolean valid(Block block) {
    return Classic.solid(block)
        && Classic.open(block.getRelative(BlockFace.UP))
        && Classic.open(block.getRelative(BlockFace.UP, 2));
  }

  /**
   * Red Warfare's {@code UtilLoc.isLookingAt}: walking from the eye along the look a tenth of a
   * block at a time, as far as the block's centre (nudged by four tenths along each axis the look
   * leans), meets the block before any other full solid block.
   */
  static boolean lookingAt(Player player, Block block) {
    var from = player.getEyeLocation();
    var step = from.getDirection().multiply(0.1);
    var target =
        block
            .getLocation()
            .add(0.5, 0.5, 0.5)
            .add(new Vector(nudge(step.getX()), nudge(step.getY()), nudge(step.getZ())));
    var distance = from.distance(target);
    if (from.getBlock().equals(block)) {
      return true;
    }
    for (var walked = 0.0; walked < distance; walked += 0.1) {
      from.add(step);
      var current = from.getBlock();
      if (block.equals(current)) {
        return true;
      }
      if (Classic.solid(current)) {
        return false;
      }
    }
    return true;
  }

  /** Red Warfare's {@code UtilMath.roundTo(number, 0.4)}: 0.4 the way {@code number} leans. */
  private static double nudge(double number) {
    if (number > 0) {
      return 0.4;
    }
    return number < 0 ? -0.4 : 0;
  }
}
