package com.shepherdjerred.thestorm.qol.adapter.paper;

import static java.util.Collections.newSetFromMap;

import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.qol.domain.grave.DeathSite;
import com.shepherdjerred.thestorm.qol.domain.grave.Grave;
import com.shepherdjerred.thestorm.qol.domain.grave.GraveContents;
import com.shepherdjerred.thestorm.qol.domain.grave.GraveFilling;
import com.shepherdjerred.thestorm.qol.domain.grave.GravePlacement;
import com.shepherdjerred.thestorm.qol.domain.grave.GravePlacement.HeightRange;
import com.shepherdjerred.thestorm.qol.domain.grave.GravePos;
import com.shepherdjerred.thestorm.qol.domain.grave.ItemBytes;
import com.shepherdjerred.thestorm.qol.domain.text.DurationText;
import java.util.HashMap;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.random.RandomGenerator;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.damage.DamageType;
import org.bukkit.entity.Player;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.inventory.ItemStack;

/**
 * Turns a death into a grave.
 *
 * <p>The drops that go into the grave are taken out of the death's drop list and the inventory
 * empties as vanilla empties it. The death handoff is stored in player data together with the
 * emptied inventory before the grave is written to SQLite. A failed write remains recoverable on
 * the next join. Arena items never go into a grave. Main thread only.
 */
final class GraveDeaths {

  private final QolRuntime runtime;
  private final GraveParts parts;
  private final LastSafeSpots safe;
  private final RandomGenerator random;

  GraveDeaths(QolRuntime runtime, GraveParts parts, LastSafeSpots safe, RandomGenerator random) {
    this.runtime = runtime;
    this.parts = parts;
    this.safe = safe;
    this.random = random;
  }

  void died(PlayerDeathEvent event) {
    if (!com.shepherdjerred.thestorm.core.players.Humans.isHuman(event.getEntity())) return;
    var player = event.getEntity();
    if (event.getKeepInventory() || parts.sealed().isSealed(player.getWorld())) {
      return;
    }
    // Paper never lists nulls here, but some servers and test doubles do.
    var buried =
        event.getDrops().stream()
            .filter(stack -> stack != null && !stack.isEmpty() && !ArenaTags.isArenaItem(stack))
            .toList();
    if (buried.isEmpty()) {
      return;
    }
    if (GraveHandoff.hasPendingDeath(player)) {
      runtime
          .logger()
          .warn(
              "{} has an unsettled grave handoff; leaving this death's items in vanilla drops",
              player.getName());
      Say.error(
          player, Say.GRAVES, "Your earlier grave is still settling; these items dropped here.");
      return;
    }
    if (!parts.registry().isLoaded()) {
      runtime.logger().warn("Graves are not loaded; {} drops their items", player.getName());
      return;
    }
    var spot = spot(player, event);
    if (spot.isEmpty()) {
      Say.error(player, Say.GRAVES, "There was no room for a grave, so your items dropped.");
      return;
    }
    var block = spot.orElseThrow();
    var grave =
        new Grave(
            new UUID(random.nextLong(), random.nextLong()),
            player.getUniqueId(),
            player.getName(),
            Blocks.pos(block),
            runtime.time().instant(),
            block.getBlockData().getAsString());
    var contents = new GraveContents(grave, GraveFilling.fill(encode(buried), inventory(player)));
    parts.registry().reserve(grave.pos(), grave.id());
    GraveBlocks.place(block, grave, parts.hooks().face());
    GraveHandoff.rememberDeath(player, contents);
    var taken = newSetFromMap(new IdentityHashMap<ItemStack, Boolean>());
    taken.addAll(buried);
    event.getDrops().removeIf(taken::contains);
    // The inventory is emptied once this event returns. SQLite must not commit
    // the grave until player.dat holds the empty inventory and this handoff.
    runtime.scheduler().runOnMainThread(() -> persistThenCreate(player, contents));
  }

  /** Replays a death whose player-data handoff survived a restart or failed database write. */
  void recover(Player player) {
    if (!parts.registry().isLoaded()) {
      return;
    }
    GraveHandoff.death(player).ifPresent(contents -> persistThenCreate(player, contents));
  }

  private void persistThenCreate(Player player, GraveContents contents) {
    try {
      parts.hooks().saveData().accept(player);
    } catch (RuntimeException failure) {
      runtime.report("saving player data before grave creation", failure);
      return;
    }
    runtime.onMain(
        parts.store().create(contents),
        "saving " + player.getName() + "'s grave",
        done -> saved(contents),
        failure -> notSaved(contents));
  }

  private void saved(GraveContents contents) {
    var grave = contents.grave();
    runtime.onMain(
        parts.store().loadAll(),
        "reconciling " + grave.ownerName() + "'s saved grave",
        graves -> {
          var stored =
              graves.stream()
                  .filter(candidate -> candidate.grave().id().equals(grave.id()))
                  .findFirst();
          if (stored.isPresent()) {
            parts.registry().put(stored.orElseThrow());
          } else {
            parts.registry().release(grave.pos());
          }
          var player = runtime.server().getPlayer(grave.owner());
          if (player != null) {
            GraveHandoff.clearDeath(player);
            parts.hooks().saveData().accept(player);
            if (stored.isPresent()) {
              Say.info(
                  player,
                  Say.GRAVES,
                  "Your items are in a grave at "
                      + grave.pos().describe()
                      + ". Only you can open it for the next "
                      + DurationText.of(parts.policy().lockedFor())
                      + ". /graves lists your graves.");
            }
          }
        },
        failure -> {});
  }

  /** The handoff stays in player data so a failed write can be retried safely. */
  private void notSaved(GraveContents contents) {
    var grave = contents.grave();
    var player = runtime.server().getPlayer(grave.owner());
    if (player != null) {
      Say.error(
          player,
          Say.GRAVES,
          "Your grave is waiting for storage; your items are safe and will be retried on join.");
    }
  }

  /**
   * A spot for the grave: open air near the death that its owner may build on, trying the death
   * spot, then the last safe spot, then the world spawn. If no such spot exists, the death spot
   * itself if it is open air; otherwise none, and the items drop as vanilla drops them.
   */
  private Optional<Block> spot(Player player, PlayerDeathEvent event) {
    var location = Blocks.at(player);
    var world = location.getWorld();
    var feet = location.getBlock();
    var damage = event.getDamageSource().getDamageType();
    var unreachable =
        location.getY() < world.getMinHeight()
            || feet.getType() == Material.LAVA
            || damage.equals(DamageType.OUT_OF_WORLD)
            || damage.equals(DamageType.LAVA);
    var site =
        new DeathSite(
            Blocks.pos(feet),
            unreachable,
            safe.of(player.getUniqueId()),
            Blocks.pos(world.getSpawnLocation().getBlock()));
    for (var origin : site.origins()) {
      var found = find(origin, player.getUniqueId());
      if (found.isPresent()) {
        return found;
      }
    }
    var inWorld = feet.getY() >= world.getMinHeight() && feet.getY() < world.getMaxHeight();
    if (!unreachable
        && inWorld
        && Blocks.cell(feet) == GravePlacement.Cell.OPEN
        && !parts.registry().isTaken(Blocks.pos(feet))) {
      return Optional.of(feet);
    }
    return Optional.empty();
  }

  private Optional<Block> find(GravePos origin, UUID owner) {
    var world = runtime.server().getWorld(origin.world());
    if (world == null) {
      return Optional.empty();
    }
    return parts
        .placement()
        .find(
            view(world, owner), new HeightRange(world.getMinHeight(), world.getMaxHeight()), origin)
        .map(pos -> world.getBlockAt(pos.x(), pos.y(), pos.z()));
  }

  /** Blocks as a grave sees them: taken spots and air the owner may not build in are blocked. */
  private GravePlacement.BlockView view(World world, UUID owner) {
    var registry = parts.registry();
    var protection = parts.protection();
    return (x, y, z) -> {
      if (registry.isTaken(new GravePos(world.getName(), x, y, z))) {
        return GravePlacement.Cell.BLOCKED;
      }
      var block = world.getBlockAt(x, y, z);
      var cell = Blocks.cell(block);
      if (cell == GravePlacement.Cell.OPEN
          && protection.check(owner, ProtectedAction.BUILD, block.getLocation())
              instanceof Decision.Denied) {
        return GravePlacement.Cell.BLOCKED;
      }
      return cell;
    };
  }

  private static List<ItemBytes> encode(List<ItemStack> drops) {
    return drops.stream().map(ItemCodec::encode).toList();
  }

  private static Map<Integer, ItemBytes> inventory(Player player) {
    var contents = Blocks.contents(player);
    var slots = new HashMap<Integer, ItemBytes>();
    for (var slot = 0; slot < contents.length; slot++) {
      var stack = contents[slot];
      if (stack != null && !stack.isEmpty()) {
        slots.put(slot, ItemCodec.encode(stack));
      }
    }
    return slots;
  }
}
