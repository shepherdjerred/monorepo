package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.qol.domain.grave.DeathSite;
import com.shepherdjerred.thestorm.qol.domain.grave.Grave;
import com.shepherdjerred.thestorm.qol.domain.grave.GraveContents;
import com.shepherdjerred.thestorm.qol.domain.grave.GraveFilling;
import com.shepherdjerred.thestorm.qol.domain.grave.GraveItem;
import com.shepherdjerred.thestorm.qol.domain.grave.GravePlacement;
import com.shepherdjerred.thestorm.qol.domain.grave.GravePlacement.HeightRange;
import com.shepherdjerred.thestorm.qol.domain.grave.GravePos;
import com.shepherdjerred.thestorm.qol.domain.grave.ItemBytes;
import com.shepherdjerred.thestorm.qol.domain.text.DurationText;
import java.util.Base64;
import java.util.Collections;
import java.util.HashMap;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.random.RandomGenerator;
import org.bukkit.Location;
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
 * empties as vanilla empties it; the player's data is saved to disk right after, so a crash cannot
 * restore an older inventory that still holds them. The grave is then saved. If saving fails the
 * items go back to the player (or, if they left, drop where they died) and are logged, so nothing
 * is ever lost or doubled. Arena items never go into a grave. Main thread only.
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
    if (event.getKeepInventory()) {
      return;
    }
    var player = event.getEntity();
    // Paper never lists nulls here, but some servers and test doubles do.
    var buried =
        event.getDrops().stream()
            .filter(stack -> stack != null && !stack.isEmpty() && !ArenaTags.isArenaItem(stack))
            .toList();
    if (buried.isEmpty()) {
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
    var taken = Collections.newSetFromMap(new IdentityHashMap<ItemStack, Boolean>());
    taken.addAll(buried);
    event.getDrops().removeIf(taken::contains);
    // The inventory is emptied once this event returns; save it to disk straight after.
    runtime
        .scheduler()
        .runOnMainThread(
            () -> {
              if (player.isOnline()) {
                parts.hooks().saveData().accept(player);
              }
            });
    var diedAt = Blocks.at(player).clone();
    runtime.onMain(
        parts.store().create(contents),
        "saving " + player.getName() + "'s grave",
        done -> saved(contents),
        failure -> notSaved(contents, block, diedAt));
  }

  private void saved(GraveContents contents) {
    var grave = contents.grave();
    parts.registry().put(contents);
    var player = runtime.server().getPlayer(grave.owner());
    if (player != null) {
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

  /** The grave could not be saved: its items go back to their owner, never lost, never doubled. */
  private void notSaved(GraveContents contents, Block block, Location diedAt) {
    var grave = contents.grave();
    parts.registry().release(grave.pos());
    GraveBlocks.clear(block, grave.id(), runtime.server().createBlockData(grave.replaced()));
    for (var item : contents.items()) {
      runtime
          .logger()
          .error(
              "Unsaved grave item for {} ({}): {}",
              grave.ownerName(),
              grave.owner(),
              Base64.getEncoder().encodeToString(item.item().bytes()));
    }
    var player = runtime.server().getPlayer(grave.owner());
    if (player != null) {
      give(player, contents.items());
      Say.error(player, Say.GRAVES, "Your grave could not be saved, so your items are back.");
    } else {
      contents.items().forEach(item -> diedAt.getWorld().dropItemNaturally(diedAt, decode(item)));
      runtime
          .logger()
          .error("{} was offline; the items dropped where they died", grave.ownerName());
    }
  }

  private static void give(Player player, List<GraveItem> items) {
    var inventory = player.getInventory();
    for (var item : items) {
      for (var left : inventory.addItem(decode(item)).values()) {
        player.getWorld().dropItemNaturally(Blocks.at(player), left);
      }
    }
  }

  private static ItemStack decode(GraveItem item) {
    return ItemCodec.decode(item.item());
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
