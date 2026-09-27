package com.shepherdjerred.thestorm.spells.adapter.paper;

import com.shepherdjerred.thestorm.spells.app.SpellStore;
import com.shepherdjerred.thestorm.spells.domain.FocusKey;
import com.shepherdjerred.thestorm.spells.domain.Refusal;
import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import com.shepherdjerred.thestorm.spells.domain.cast.CastAttempt;
import com.shepherdjerred.thestorm.spells.domain.cast.CastMode;
import com.shepherdjerred.thestorm.spells.domain.cast.CastRules;
import com.shepherdjerred.thestorm.spells.domain.cast.CasterState;
import com.shepherdjerred.thestorm.spells.domain.config.Spellbook;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.function.Consumer;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;

/**
 * Binds foci. A player holds at most one working focus per spell: binding again removes the old
 * focus from their inventory and ender chest, and raises the generation so any other copy (in a
 * chest, or duplicated) is dead weight that crumbles when used.
 */
final class Binder {

  /** Slots 0-35: the hotbar and backpack, where a new focus can go. */
  private static final int STORAGE_SLOTS = 36;

  private final SpellItems items;
  private final SpellState state;
  private final Spellbook book;
  private final Storage storage;
  private final Set<FocusKey> pending = new HashSet<>();

  /**
   * Where binds are recorded.
   *
   * @param store the spells store
   * @param async logs a failed write
   */
  record Storage(SpellStore store, Async async) {}

  Binder(SpellItems items, SpellState state, Spellbook book, Storage storage) {
    this.items = items;
    this.state = state;
    this.book = book;
    this.storage = storage;
  }

  /** Whether {@code player} may bind (and so cast by focus) {@code spell}. */
  Optional<Refusal> access(Player player, SpellKind spell) {
    var caster =
        new CasterState(
            Access.tier(player),
            Access.learned(player, spell),
            Duration.ZERO,
            Duration.ZERO,
            Map.of());
    var attempt = new CastAttempt(CastMode.FOCUS, book.entry(spell).terms(), caster);
    return CastRules.binding().first(attempt);
  }

  /** Gives {@code player} a fresh focus for {@code spell}, replacing any earlier one. */
  Optional<Refusal> bind(Player player, SpellKind spell, Consumer<Boolean> completed) {
    if (!state.ready()) {
      return Optional.of(new Refusal.Loading());
    }
    var refused = access(player, spell);
    if (refused.isPresent()) {
      return refused;
    }
    // Refuse before touching anything: the new focus goes into a free hotbar or backpack slot, or
    // into the slot of the focus it replaces.
    var inventory = player.getInventory();
    var slot =
        freeSlot(inventory)
            .or(
                () ->
                    fociSlots(inventory, player, spell).stream()
                        .filter(held -> held < STORAGE_SLOTS)
                        .findFirst());
    if (slot.isEmpty()) {
      return Optional.of(new Refusal.InventoryFull());
    }
    var key = new FocusKey(player.getUniqueId(), spell);
    if (!pending.add(key)) {
      return Optional.of(new Refusal.Loading());
    }
    var generation = state.foci().next(key);
    storage
        .async()
        .onMain(
            storage.store().saveFocus(key, generation),
            "recording a " + spell.id() + " bind",
            saved -> {
              if (saved != 1) {
                pending.remove(key);
                completed.accept(false);
                return;
              }
              if (!player.isOnline()) {
                rollback(key, generation, player, completed);
                return;
              }
              var destination =
                  freeSlot(inventory)
                      .or(
                          () ->
                              fociSlots(inventory, player, spell).stream()
                                  .filter(held -> held < STORAGE_SLOTS)
                                  .findFirst());
              if (destination.isEmpty()) {
                rollback(key, generation, player, completed);
                return;
              }
              removeFoci(inventory, player, spell);
              removeFoci(player.getEnderChest(), player, spell);
              inventory.setItem(
                  destination.get(), items.focus(spell, player.getUniqueId(), generation));
              state.foci().restore(Map.of(key, generation));
              pending.remove(key);
              completed.accept(true);
            },
            failure -> {
              pending.remove(key);
              completed.accept(false);
            });
    return Optional.empty();
  }

  private void rollback(FocusKey key, long generation, Player player, Consumer<Boolean> completed) {
    storage
        .async()
        .onMain(
            storage.store().rollbackFocus(key, generation),
            "rolling back an undelivered focus bind",
            rolledBack -> {
              pending.remove(key);
              if (rolledBack != 1) {
                storage.async().logger().error("Focus bind rollback changed no row for {}", key);
                player.getServer().shutdown();
              }
              completed.accept(false);
            },
            failure -> {
              pending.remove(key);
              player.getServer().shutdown();
              completed.accept(false);
            });
  }

  private static Optional<Integer> freeSlot(Inventory inventory) {
    for (var slot = 0; slot < STORAGE_SLOTS; slot++) {
      var item = inventory.getItem(slot);
      if (item == null || item.isEmpty()) {
        return Optional.of(slot);
      }
    }
    return Optional.empty();
  }

  private void removeFoci(Inventory inventory, Player owner, SpellKind spell) {
    for (var slot : fociSlots(inventory, owner, spell)) {
      inventory.setItem(slot, null);
    }
  }

  /** The slots holding {@code owner}'s foci for {@code spell}. */
  private List<Integer> fociSlots(Inventory inventory, Player owner, SpellKind spell) {
    var slots = new ArrayList<Integer>();
    for (var slot = 0; slot < inventory.getSize(); slot++) {
      var item = inventory.getItem(slot);
      if (item != null
          && items.identify(item).orElse(null) instanceof SpellIdentity.Focus focus
          && focus.spell() == spell
          && focus.owner().equals(owner.getUniqueId())) {
        slots.add(slot);
      }
    }
    return slots;
  }
}
