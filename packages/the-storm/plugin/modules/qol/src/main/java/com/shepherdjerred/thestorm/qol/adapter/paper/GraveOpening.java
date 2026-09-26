package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.shepherdjerred.thestorm.qol.app.GraveRegistry;
import com.shepherdjerred.thestorm.qol.app.store.GraveStore;
import com.shepherdjerred.thestorm.qol.domain.grave.Grave;
import com.shepherdjerred.thestorm.qol.domain.grave.GraveContents;
import com.shepherdjerred.thestorm.qol.domain.grave.GraveItem;
import com.shepherdjerred.thestorm.qol.domain.grave.GravePolicy;
import com.shepherdjerred.thestorm.qol.domain.grave.GravePolicy.Access;
import com.shepherdjerred.thestorm.qol.domain.grave.GravePolicy.Opener;
import com.shepherdjerred.thestorm.qol.domain.grave.GravePolicy.Status;
import com.shepherdjerred.thestorm.qol.domain.text.DurationText;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.jspecify.annotations.Nullable;

/**
 * Opening a grave by right-clicking it. Stacks leave storage in the same transaction that hands
 * them out and each grave is locked while one opening runs, so two players clicking at once can
 * never both receive the same stack. Main thread only.
 */
final class GraveOpening {

  private final QolRuntime runtime;
  private final GraveStore store;
  private final GraveRegistry registry;
  private final GravePolicy policy;
  private final ServerHooks hooks;
  private final GraveUpkeep upkeep;

  GraveOpening(QolRuntime runtime, GraveParts parts, GraveUpkeep upkeep) {
    this.runtime = runtime;
    this.store = parts.store();
    this.registry = parts.registry();
    this.policy = parts.policy();
    this.hooks = parts.hooks();
    this.upkeep = upkeep;
  }

  void open(Player player, Block block, UUID id) {
    if (!registry.isLoaded()) {
      Say.error(player, Say.GRAVES, "Graves are still loading; try again in a moment.");
      return;
    }
    if (registry.isPending(id)) {
      Say.info(player, Say.GRAVES, "This grave is still being dug; try again in a moment.");
      return;
    }
    var found = registry.get(id);
    if (found.isEmpty()) {
      // A leftover block whose grave is already gone.
      GraveBlocks.clear(block, id, runtime.server().createBlockData(Material.AIR));
      Say.info(player, Say.GRAVES, "This grave is empty.");
      return;
    }
    var contents = found.orElseThrow();
    var grave = contents.grave();
    switch (policy.access(grave, opener(player, grave), runtime.time().instant())) {
      case Access.Locked(var remaining) ->
          Say.error(
              player,
              Say.GRAVES,
              "This is "
                  + grave.ownerName()
                  + "'s grave. It opens to everyone in "
                  + DurationText.of(remaining)
                  + ".");
      case Access.Everything() -> take(player, contents, indexes(contents.items()), true);
      case Access.WhatFits() -> take(player, contents, fitting(player, contents), false);
    }
  }

  void describe(Player player, UUID id) {
    if (registry.isPending(id)) {
      Say.info(player, Say.GRAVES, "This grave is still being dug.");
      return;
    }
    var found = registry.get(id);
    if (found.isEmpty()) {
      Say.info(player, Say.GRAVES, "This grave is empty.");
      return;
    }
    var contents = found.orElseThrow();
    var grave = contents.grave();
    var state =
        switch (policy.status(grave, runtime.time().instant())) {
          case Status.Locked(var remaining) ->
              "only " + grave.ownerName() + " can open it for " + DurationText.of(remaining);
          case Status.Open(var remaining) ->
              "anyone can open it; it breaks open in " + DurationText.of(remaining);
          case Status.Expired() -> "it is breaking open";
        };
    Say.info(
        player,
        Say.GRAVES,
        grave.ownerName()
            + "'s grave holds "
            + contents.items().size()
            + " stacks: "
            + state
            + ". Right-click to open it.");
  }

  private Opener opener(Player player, Grave grave) {
    if (player.getUniqueId().equals(grave.owner())) {
      return Opener.OWNER;
    }
    return player.hasPermission(QolPermissions.GRAVES_ADMIN) ? Opener.STAFF : Opener.OTHER;
  }

  private void take(Player player, GraveContents contents, Set<Integer> indexes, boolean all) {
    var id = contents.grave().id();
    if (indexes.isEmpty()) {
      Say.error(player, Say.GRAVES, "Your inventory is full.");
      return;
    }
    if (!registry.tryLock(id)) {
      Say.error(player, Say.GRAVES, "Someone is already opening this grave.");
      return;
    }
    var taker = player.getUniqueId();
    runtime.onMain(
        store.take(id, indexes),
        "taking from " + contents.grave().ownerName() + "'s grave",
        taken -> received(taker, contents.grave(), taken, all),
        failure -> {
          registry.unlock(id);
          var online = runtime.server().getPlayer(taker);
          if (online != null) {
            Say.error(online, Say.GRAVES, "The grave could not be opened; try again.");
          }
        });
  }

  private void received(UUID taker, Grave grave, GraveStore.Taken taken, boolean all) {
    var id = grave.id();
    var player = runtime.server().getPlayer(taker);
    if (player == null) {
      // The taker left before the items reached them: they go back in the grave.
      runtime.onMain(
          store.putBack(id, taken.items()),
          "putting stacks back into " + grave.ownerName() + "'s grave",
          done -> registry.unlock(id),
          failure -> registry.unlock(id));
      return;
    }
    var removed = indexes(taken.items());
    registry.get(id).ifPresent(contents -> registry.put(contents.without(removed)));
    var dropped = give(player, taken.items(), all);
    // The stacks already left storage: save the inventory now so a crash cannot roll it back.
    hooks.saveData().accept(player);
    tell(player, grave, taken, dropped);
    if (taken.remaining() == 0) {
      upkeep.remove(id);
    } else {
      registry.unlock(id);
    }
  }

  private static void tell(Player player, Grave grave, GraveStore.Taken taken, boolean dropped) {
    var whose = player.getUniqueId().equals(grave.owner()) ? "your" : grave.ownerName() + "'s";
    var message =
        "You took "
            + taken.items().size()
            + " stacks from "
            + whose
            + " grave."
            + (taken.remaining() > 0 ? " " + taken.remaining() + " are left in it." : "")
            + (dropped ? " What did not fit fell at your feet." : "");
    Say.success(player, Say.GRAVES, message);
  }

  /**
   * Gives {@code items} to {@code player}: with {@code all}, back into their old slots where those
   * are free. What does not fit falls at their feet. Returns whether anything fell.
   */
  private static boolean give(Player player, List<GraveItem> items, boolean all) {
    var inventory = player.getInventory();
    var overflow = new ArrayList<ItemStack>();
    for (var item : items) {
      var stack = ItemCodec.decode(item.item());
      var slot = item.slot();
      if (all && slot.isPresent() && slot.getAsInt() < inventory.getSize()) {
        var current = inventory.getItem(slot.getAsInt());
        if (current == null || current.isEmpty()) {
          inventory.setItem(slot.getAsInt(), stack);
          continue;
        }
      }
      overflow.addAll(inventory.addItem(stack).values());
    }
    for (var stack : overflow) {
      player.getWorld().dropItemNaturally(Blocks.at(player), stack);
    }
    return !overflow.isEmpty();
  }

  /** The stacks, in order, that fit whole into what is free in {@code player}'s inventory. */
  private Set<Integer> fitting(Player player, GraveContents contents) {
    var storage = Blocks.storage(player.getInventory());
    var trial = runtime.server().createInventory(null, storage.length);
    trial.setStorageContents(copy(storage));
    var fits = new HashSet<Integer>();
    for (var item : contents.items()) {
      var before = copy(Blocks.storage(trial));
      if (trial.addItem(ItemCodec.decode(item.item())).isEmpty()) {
        fits.add(item.index());
      } else {
        trial.setStorageContents(before);
      }
    }
    return fits;
  }

  private static @Nullable ItemStack[] copy(@Nullable ItemStack[] stacks) {
    @Nullable ItemStack[] copy = new ItemStack[stacks.length];
    for (var i = 0; i < stacks.length; i++) {
      var stack = stacks[i];
      copy[i] = stack == null ? null : stack.clone();
    }
    return copy;
  }

  private static Set<Integer> indexes(List<GraveItem> items) {
    return items.stream().map(GraveItem::index).collect(Collectors.toUnmodifiableSet());
  }
}
