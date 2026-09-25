package com.shepherdjerred.thestorm.shops.adapter.paper;

import static java.util.Objects.requireNonNull;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.shops.app.Holdings;
import com.shepherdjerred.thestorm.shops.domain.stock.Slot;
import com.shepherdjerred.thestorm.shops.domain.stock.SlotChange;
import com.shepherdjerred.thestorm.shops.domain.stock.Stock;
import com.shepherdjerred.thestorm.shops.domain.trade.Stockpile;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.function.Supplier;
import org.bukkit.Location;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.jspecify.annotations.Nullable;

/**
 * A shop item's supply in a real inventory, read live on every call. The domain's {@link Stock}
 * plans exactly which slots change; this class only applies the plan, so partial stacks, small
 * stack sizes and other items in the inventory are handled in one tested place.
 */
final class InventoryHoldings implements Holdings {

  /** The main inventory and hotbar: slots 0-35, never armor or the off hand. */
  private static final int PLAYER_STORAGE_SLOTS = 36;

  private final Supplier<Optional<Inventory>> inventory;
  private final int slots;
  private final ItemStack template;
  private final Supplier<Optional<Location>> dropAt;

  private InventoryHoldings(
      Supplier<Optional<Inventory>> inventory,
      int slots,
      ItemStack template,
      Supplier<Optional<Location>> dropAt) {
    this.inventory = inventory;
    this.slots = slots;
    this.template = template.asOne();
    this.dropAt = dropAt;
  }

  /** A player's main inventory and hotbar; overflow drops at their feet. */
  static InventoryHoldings of(Player player, ItemStack template) {
    return new InventoryHoldings(
        () -> Optional.of(player.getInventory()),
        PLAYER_STORAGE_SLOTS,
        template,
        () -> Optional.ofNullable(player.getLocation()));
  }

  /**
   * A container, looked up again on every call so a broken or replaced container simply has no
   * stock and no room.
   */
  static InventoryHoldings of(
      Supplier<Optional<Inventory>> container,
      ItemStack template,
      Supplier<Optional<Location>> dropAt) {
    return new InventoryHoldings(container, Integer.MAX_VALUE, template, dropAt);
  }

  @Override
  public Stockpile stockpile() {
    var contents = slots();
    return new Stockpile(Stock.count(contents), Stock.space(contents, template.getMaxStackSize()));
  }

  @Override
  public void remove(int quantity) {
    apply(Stock.planRemoval(slots(), quantity));
  }

  @Override
  public void add(int quantity) {
    apply(Stock.planInsertion(slots(), quantity, template.getMaxStackSize()));
  }

  @Override
  public void addOrDrop(int quantity) {
    var fits = Math.min(quantity, stockpile().space());
    if (fits > 0) {
      add(fits);
    }
    var left = quantity - fits;
    var location = dropAt.get();
    while (left > 0 && location.isPresent()) {
      var stack = Math.min(left, template.getMaxStackSize());
      var at = location.orElseThrow();
      at.getWorld().dropItemNaturally(at, template.asQuantity(stack));
      left -= stack;
    }
    if (left > 0) {
      throw new IllegalStateException(left + " returned items had nowhere to go");
    }
  }

  private List<Slot> slots() {
    var live = inventory.get();
    if (live.isEmpty()) {
      return List.of();
    }
    var contents = requireNonNull(live.orElseThrow().getContents());
    var count = Math.min(slots, contents.length);
    var result = new ArrayList<Slot>(count);
    for (var index = 0; index < count; index++) {
      result.add(slotOf(contents[index]));
    }
    return result;
  }

  private Slot slotOf(@Nullable ItemStack item) {
    if (item == null || item.getType().isAir() || item.getAmount() < 1) {
      return Slot.empty();
    }
    return template.isSimilar(item) ? Slot.same(item.getAmount()) : Slot.other();
  }

  private void apply(Result<List<SlotChange>, Stock.Shortfall> plan) {
    var changes =
        switch (plan) {
          case Result.Ok<List<SlotChange>, Stock.Shortfall>(var value) -> value;
          case Result.Err<List<SlotChange>, Stock.Shortfall>(var shortfall) ->
              throw new IllegalStateException(
                  "planned "
                      + shortfall.needed()
                      + " items but only "
                      + shortfall.available()
                      + " fit or were held; check the stockpile first");
        };
    var live =
        inventory.get().orElseThrow(() -> new IllegalStateException("the inventory is gone"));
    for (var change : changes) {
      live.setItem(
          change.index(), change.amount() == 0 ? null : template.asQuantity(change.amount()));
    }
  }
}
