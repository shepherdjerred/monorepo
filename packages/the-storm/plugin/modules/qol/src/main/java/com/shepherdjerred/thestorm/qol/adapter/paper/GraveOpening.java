package com.shepherdjerred.thestorm.qol.adapter.paper;

import static java.util.stream.Collectors.toUnmodifiableSet;

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
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.random.RandomGenerator;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.entity.ItemDisplay;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.jspecify.annotations.Nullable;

/**
 * Opening a grave by right-clicking it. A claim keeps stacks in SQLite until the recipient's player
 * data has saved a delivery receipt; only then are the stored rows removed. Main thread only.
 */
final class GraveOpening {

  private record Transfer(
      GraveStore.Claim claim,
      Grave grave,
      Set<Integer> overflow,
      @Nullable ItemDisplay entity,
      boolean all) {}

  private final QolRuntime runtime;
  private final GraveStore store;
  private final GraveRegistry registry;
  private final GravePolicy policy;
  private final ServerHooks hooks;
  private final GraveUpkeep upkeep;
  private final RandomGenerator random;
  private final Set<UUID> receiving = new HashSet<>();

  GraveOpening(QolRuntime runtime, GraveParts parts, GraveUpkeep upkeep, RandomGenerator random) {
    this.runtime = runtime;
    this.store = parts.store();
    this.registry = parts.registry();
    this.policy = parts.policy();
    this.hooks = parts.hooks();
    this.upkeep = upkeep;
    this.random = random;
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
    if (upkeep.expireIfDue(id)) {
      Say.info(player, Say.GRAVES, "This grave has expired and is breaking open.");
      return;
    }
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
      case Access.Everything() -> take(player, contents, fitting(player, contents), true);
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
    if (upkeep.expireIfDue(id)) {
      Say.info(player, Say.GRAVES, "This grave has expired and is breaking open.");
      return;
    }
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
    var overflow = new HashSet<>(indexes(contents.items()));
    overflow.removeAll(indexes);
    if (indexes.isEmpty()) {
      if (all && !overflow.isEmpty() && registry.tryLock(id)) {
        upkeep.offerOverflow(player, contents.grave(), overflow);
        return;
      }
      Say.error(player, Say.GRAVES, "Your inventory is full.");
      return;
    }
    if (GraveHandoff.receipt(player).isPresent() || !receiving.add(player.getUniqueId())) {
      Say.error(player, Say.GRAVES, "Your previous grave transfer is still settling.");
      return;
    }
    if (!registry.tryLock(id)) {
      receiving.remove(player.getUniqueId());
      Say.error(player, Say.GRAVES, "Someone is already opening this grave.");
      return;
    }
    var taker = player.getUniqueId();
    var token = new UUID(random.nextLong(), random.nextLong());
    runtime.onMain(
        store.reserveTake(
            new GraveStore.TakeRequest(id, taker, token, indexes, runtime.time().instant())),
        "taking from " + contents.grave().ownerName() + "'s grave",
        claim -> received(new Transfer(claim, contents.grave(), overflow, null, all)),
        failure -> {
          registry.unlock(id);
          receiving.remove(taker);
          var online = runtime.server().getPlayer(taker);
          if (online != null) {
            Say.error(online, Say.GRAVES, "The grave could not be opened; try again.");
          }
        });
  }

  /** A tagged display remains a projection until this durable claim is saved. */
  void nearby(Player player) {
    if (!registry.isLoaded() || receiving.contains(player.getUniqueId())) {
      return;
    }
    for (var entity : player.getNearbyEntities(1.25, 1.25, 1.25)) {
      if (entity instanceof ItemDisplay display) {
        var key = GraveDropEntity.key(display);
        if (key.isPresent()) {
          pickup(player, display, key.orElseThrow());
          return;
        }
      }
    }
  }

  /** Claims a projected grave stack through the same saved-receipt path as opening. */
  void pickup(Player player, ItemDisplay entity, GraveDropEntity.Key key) {
    var taker = player.getUniqueId();
    if (GraveHandoff.receipt(player).isPresent() || !receiving.add(taker)) {
      return;
    }
    if (!registry.tryLock(key.grave())) {
      receiving.remove(taker);
      return;
    }
    runtime.onMain(
        store.pendingDrops(),
        "checking grave ground item",
        drops -> {
          var found =
              drops.stream()
                  .filter(
                      drop ->
                          drop.grave().equals(key.grave()) && drop.item().index() == key.index())
                  .findFirst();
          if (found.isEmpty()) {
            entity.remove();
            registry.unlock(key.grave());
            receiving.remove(taker);
            return;
          }
          var drop = found.orElseThrow();
          if (drop.ownerOnly()
              && policy.isExpired(
                  registry.get(key.grave()).orElseThrow().grave(), runtime.time().instant())) {
            registry.unlock(key.grave());
            receiving.remove(taker);
            upkeep.expireIfDue(key.grave());
            return;
          }
          if (drop.ownerOnly()
              && registry.get(key.grave()).stream()
                  .noneMatch(contents -> contents.grave().owner().equals(taker))) {
            registry.unlock(key.grave());
            receiving.remove(taker);
            return;
          }
          var token = new UUID(random.nextLong(), random.nextLong());
          runtime.onMain(
              store.reserveDrop(
                  new GraveStore.DropRequest(
                      key.grave(), key.index(), taker, token, runtime.time().instant())),
              "reserving grave ground item",
              claim -> {
                var grave =
                    registry
                        .get(key.grave())
                        .orElseThrow(() -> new IllegalStateException("drop grave missing"))
                        .grave();
                received(new Transfer(claim, grave, Set.of(), entity, false));
              },
              failure -> {
                registry.unlock(key.grave());
                receiving.remove(taker);
              });
        },
        failure -> {
          registry.unlock(key.grave());
          receiving.remove(taker);
        });
  }

  private void received(Transfer transfer) {
    var claim = transfer.claim();
    var player = runtime.server().getPlayer(claim.taker());
    if (player == null || !player.isOnline()) {
      release(claim);
      return;
    }
    if (claim.items().isEmpty() || !give(player, claim.items(), transfer.all())) {
      release(claim);
      Say.error(player, Say.GRAVES, "Your inventory changed; try opening the grave again.");
      return;
    }
    GraveHandoff.receipt(player, claim.token());
    try {
      hooks.saveData().accept(player);
    } catch (RuntimeException failure) {
      runtime.report("saving grave claim to player data", failure);
      Say.error(player, Say.GRAVES, "Your grave transfer is waiting for a safe save.");
      return;
    }
    finish(transfer, player);
  }

  /** Reconciles a pending claim against the player's saved receipt after a restart or rejoin. */
  void recover(Player player) {
    if (!registry.isLoaded()) {
      return;
    }
    var taker = player.getUniqueId();
    runtime.onMain(
        store.pendingClaims(),
        "recovering grave claims",
        claims -> {
          var receipt = GraveHandoff.receipt(player);
          var mine = claims.stream().filter(claim -> claim.taker().equals(taker)).toList();
          for (var claim : mine) {
            if (receipt.filter(claim.token()::equals).isPresent()) {
              var grave =
                  registry
                      .get(claim.grave())
                      .orElseThrow(() -> new IllegalStateException("claim grave missing"))
                      .grave();
              finish(new Transfer(claim, grave, Set.of(), null, false), player);
            } else {
              release(claim);
            }
          }
          if (receipt.isPresent()
              && mine.stream()
                  .noneMatch(claim -> receipt.filter(claim.token()::equals).isPresent())) {
            GraveHandoff.clearReceipt(player);
            hooks.saveData().accept(player);
          }
        },
        failure -> {});
  }

  private void finish(Transfer transfer, Player player) {
    var claim = transfer.claim();
    runtime.onMain(
        store.finishTake(claim.token(), claim.taker()),
        "finishing grave claim",
        taken -> completed(transfer, player, taken),
        failure -> Say.error(player, Say.GRAVES, "Your grave transfer will retry on join."));
  }

  private void completed(Transfer transfer, Player player, GraveStore.Taken taken) {
    var claim = transfer.claim();
    var grave = transfer.grave();
    var entity = transfer.entity();
    var id = grave.id();
    if (taken.items().isEmpty()) {
      GraveHandoff.clearReceipt(player);
      receiving.remove(claim.taker());
      registry.unlock(id);
      if (entity != null && entity.isValid()) {
        entity.remove();
      }
      return;
    }
    registry.get(id).ifPresent(contents -> registry.put(contents.without(indexes(claim.items()))));
    GraveHandoff.clearReceipt(player);
    try {
      hooks.saveData().accept(player);
    } catch (RuntimeException failure) {
      // The saved receipt is still safe. A later player-data save or rejoin clears it.
      runtime.report("clearing finished grave receipt from player data", failure);
    }
    receiving.remove(claim.taker());
    if (entity != null && entity.isValid()) {
      entity.remove();
    }
    tell(player, grave, taken, false);
    if (transfer.all() && !transfer.overflow().isEmpty()) {
      upkeep.offerOverflow(player, grave, transfer.overflow());
    } else if (taken.remaining() == 0) {
      upkeep.remove(id);
    } else {
      registry.unlock(id);
    }
    if (entity != null) {
      nearby(player);
    }
  }

  private void release(GraveStore.Claim claim) {
    runtime.onMain(
        store.releaseTake(claim.token(), claim.taker()),
        "releasing an undelivered grave claim",
        done -> {
          registry.unlock(claim.grave());
          receiving.remove(claim.taker());
        },
        failure -> {});
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
    var before = copy(Blocks.contents(player));
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
      if (!inventory.addItem(stack).isEmpty()) {
        inventory.setContents(before);
        return false;
      }
    }
    return true;
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
    return items.stream().map(GraveItem::index).collect(toUnmodifiableSet());
  }
}
