package com.shepherdjerred.thestorm.shops.adapter.paper;

import static java.util.Objects.requireNonNull;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.shops.app.Holdings;
import com.shepherdjerred.thestorm.shops.domain.stock.Slot;
import com.shepherdjerred.thestorm.shops.domain.stock.SlotChange;
import com.shepherdjerred.thestorm.shops.domain.stock.Stock;
import com.shepherdjerred.thestorm.shops.domain.trade.Stockpile;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.function.Supplier;
import org.bukkit.Location;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.jspecify.annotations.Nullable;

/** Plans the complete bundle before changing any live slot; quantities count whole deals. */
final class BundleHoldings implements Holdings {
  private record Part(ItemStack template, int amount) {}

  private final Supplier<Optional<Inventory>> inventory;
  private final Supplier<Optional<Location>> dropAt;
  private final List<Part> parts;

  BundleHoldings(
      Supplier<Optional<Inventory>> inventory,
      List<ItemStack> items,
      Supplier<Optional<Location>> dropAt) {
    this.inventory = inventory;
    this.dropAt = dropAt;
    var merged = new ArrayList<Part>();
    for (var item : items) {
      if (item.getType().isAir() || item.getAmount() < 1)
        throw new IllegalArgumentException("empty bundle item");
      var previous = merged.stream().filter(part -> part.template().isSimilar(item)).findFirst();
      if (previous.isPresent()) {
        var part = previous.orElseThrow();
        merged.set(
            merged.indexOf(part),
            new Part(part.template(), Math.addExact(part.amount(), item.getAmount())));
      } else {
        merged.add(new Part(item.asOne(), item.getAmount()));
      }
    }
    if (merged.isEmpty()) throw new IllegalArgumentException("empty shop bundle");
    parts = List.copyOf(merged);
  }

  @Override
  public Stockpile stockpile() {
    var live = inventory.get();
    if (live.isEmpty()) return new Stockpile(0, 0);
    var contents = requireNonNull(live.orElseThrow().getStorageContents(), "storage contents");
    var count = Integer.MAX_VALUE;
    var upper = Integer.MAX_VALUE;
    for (var part : parts) {
      var slots = slots(contents, part.template());
      count = Math.min(count, Stock.count(slots) / part.amount());
      upper =
          Math.min(upper, Stock.space(slots, part.template().getMaxStackSize()) / part.amount());
    }
    var lower = 0;
    while (lower < upper) {
      var middle = lower + (upper - lower + 1) / 2;
      if (plan(contents, middle, true).isPresent()) lower = middle;
      else upper = middle - 1;
    }
    return new Stockpile(count, lower);
  }

  @Override
  public void remove(int quantity) {
    apply(quantity, false);
  }

  @Override
  public void add(int quantity) {
    apply(quantity, true);
  }

  @Override
  public void addOrDrop(int quantity) {
    var fits = Math.min(quantity, stockpile().space());
    if (fits > 0) add(fits);
    if (fits == quantity) return;
    var at =
        dropAt
            .get()
            .orElseThrow(() -> new IllegalStateException("returned bundle has nowhere to go"));
    for (var part : parts) {
      var remaining = Math.multiplyExact(quantity - fits, part.amount());
      while (remaining > 0) {
        var stack = Math.min(remaining, part.template().getMaxStackSize());
        at.getWorld().dropItemNaturally(at, part.template().asQuantity(stack));
        remaining -= stack;
      }
    }
  }

  private void apply(int quantity, boolean adding) {
    var live =
        inventory.get().orElseThrow(() -> new IllegalStateException("bundle inventory is gone"));
    var changed =
        plan(requireNonNull(live.getStorageContents(), "storage contents"), quantity, adding)
            .orElseThrow(() ->
                new IllegalStateException("the complete shop bundle does not fit or is not held"));
    live.setStorageContents(changed);
  }

  private Optional<@Nullable ItemStack[]> plan(
      @Nullable ItemStack[] contents, int quantity, boolean adding) {
    if (quantity < 0) throw new IllegalArgumentException("negative bundle quantity");
    var changed = contents.clone();
    for (var part : parts) {
      var amount = Math.multiplyExact(quantity, part.amount());
      var slots = slots(changed, part.template());
      var result =
          adding
              ? Stock.planInsertion(slots, amount, part.template().getMaxStackSize())
              : Stock.planRemoval(slots, amount);
      if (!(result instanceof Result.Ok<List<SlotChange>, Stock.Shortfall>(var changes)))
        return Optional.empty();
      for (var change : changes) {
        changed[change.index()] =
            change.amount() == 0 ? null : part.template().asQuantity(change.amount());
      }
    }
    return Optional.of(changed);
  }

  private static List<Slot> slots(@Nullable ItemStack[] contents, ItemStack template) {
    return Arrays.stream(contents)
        .<Slot>map(item -> {
          if (item == null || item.getType().isAir() || item.getAmount() < 1) return Slot.empty();
          return template.isSimilar(item) ? Slot.same(item.getAmount()) : Slot.other();
        })
        .toList();
  }
}
