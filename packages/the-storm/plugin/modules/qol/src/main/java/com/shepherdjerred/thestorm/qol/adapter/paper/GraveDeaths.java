package com.shepherdjerred.thestorm.qol.adapter.paper;

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
 * <p>Items are never in two places and never only in memory. At death the drops are cleared but the
 * player keeps their inventory; only once the grave is saved is that inventory emptied. If the
 * server stops before the save finishes, the player still has their items and no grave exists; if
 * the save fails, they keep their items. While a save is running the player cannot move items out
 * of their inventory. Main thread only.
 */
final class GraveDeaths {

  private final QolRuntime runtime;
  private final GraveParts parts;
  private final LastSafeSpots safe;
  private final RandomGenerator random;
  private final Map<UUID, UUID> pending = new HashMap<>();

  GraveDeaths(QolRuntime runtime, GraveParts parts, LastSafeSpots safe, RandomGenerator random) {
    this.runtime = runtime;
    this.parts = parts;
    this.safe = safe;
    this.random = random;
  }

  void died(PlayerDeathEvent event) {
    if (event.getKeepInventory()) {
      return;
    }
    var player = event.getEntity();
    // Paper never lists nulls here, but some servers and test doubles do.
    var drops =
        event.getDrops().stream().filter(stack -> stack != null && !stack.isEmpty()).toList();
    if (drops.isEmpty()) {
      return;
    }
    if (!parts.registry().isLoaded()) {
      runtime.logger().warn("Graves are not loaded yet; {} drops their items", player.getName());
      return;
    }
    var spot = spot(player, event);
    if (spot.isEmpty()) {
      keepInventory(event);
      Say.error(player, Say.GRAVES, "There was no room for a grave, so you kept your items.");
      return;
    }
    var block = spot.orElseThrow();
    var grave =
        new Grave(
            new UUID(random.nextLong(), random.nextLong()),
            player.getUniqueId(),
            player.getName(),
            Blocks.pos(block),
            runtime.time().instant());
    var contents = new GraveContents(grave, GraveFilling.fill(encode(drops), inventory(player)));
    parts.registry().reserve(grave.pos());
    GraveBlocks.place(block, grave, parts.face());
    keepInventory(event);
    pending.put(player.getUniqueId(), grave.id());
    runtime.onMain(
        parts.store().create(contents),
        "saving " + player.getName() + "'s grave",
        done -> saved(contents),
        failure -> notSaved(contents, block));
  }

  /** Whether {@code player}'s grave is still being saved, so their items must stay put. */
  boolean isPending(UUID player) {
    return pending.containsKey(player);
  }

  /**
   * {@code player} is leaving while their grave is being saved: their inventory is emptied now,
   * before the server saves it, so the items are not in both the grave and their saved inventory.
   */
  void quit(Player player) {
    if (pending.containsKey(player.getUniqueId())) {
      emptyInventory(player);
    }
  }

  private void saved(GraveContents contents) {
    var grave = contents.grave();
    pending.remove(grave.owner(), grave.id());
    parts.registry().put(contents);
    var player = runtime.server().getPlayer(grave.owner());
    if (player == null) {
      return;
    }
    emptyInventory(player);
    Say.info(
        player,
        Say.GRAVES,
        "Your items are in a grave at "
            + grave.pos().describe()
            + ". Only you can open it for the next "
            + DurationText.of(parts.policy().lockedFor())
            + ". /graves lists your graves.");
  }

  private void notSaved(GraveContents contents, Block block) {
    var grave = contents.grave();
    pending.remove(grave.owner(), grave.id());
    parts.registry().release(grave.pos());
    GraveBlocks.clear(block, grave.id());
    var player = runtime.server().getPlayer(grave.owner());
    if (player == null) {
      runtime
          .logger()
          .error(
              "{}'s grave ({} stacks) could not be saved after they left; the stacks are lost",
              grave.ownerName(),
              contents.items().size());
      return;
    }
    Say.error(player, Say.GRAVES, "Your grave could not be saved, so you kept your items.");
  }

  private static void keepInventory(PlayerDeathEvent event) {
    event.getDrops().clear();
    event.setKeepInventory(true);
  }

  private static void emptyInventory(Player player) {
    player.getInventory().clear();
  }

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
      var found = find(origin);
      if (found.isPresent()) {
        return found;
      }
    }
    return Optional.empty();
  }

  private Optional<Block> find(GravePos origin) {
    var world = runtime.server().getWorld(origin.world());
    if (world == null) {
      return Optional.empty();
    }
    return parts
        .placement()
        .find(view(world), new HeightRange(world.getMinHeight(), world.getMaxHeight()), origin)
        .map(pos -> world.getBlockAt(pos.x(), pos.y(), pos.z()));
  }

  private GravePlacement.BlockView view(World world) {
    var registry = parts.registry();
    return (x, y, z) ->
        registry.isTaken(new GravePos(world.getName(), x, y, z))
            ? GravePlacement.Cell.BLOCKED
            : Blocks.cell(world.getBlockAt(x, y, z));
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
