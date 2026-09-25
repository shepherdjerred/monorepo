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
import java.util.Map;
import java.util.Optional;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;

/**
 * Binds foci. A player holds at most one working focus per spell: binding again removes the old
 * focus from their inventory and ender chest, and raises the generation so any other copy (in a
 * chest, or duplicated) is dead weight that crumbles when used.
 */
final class Binder {

  private final SpellItems items;
  private final SpellState state;
  private final Spellbook book;
  private final Storage storage;

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
  Optional<Refusal> bind(Player player, SpellKind spell) {
    if (!state.ready()) {
      return Optional.of(new Refusal.Loading());
    }
    var refused = access(player, spell);
    if (refused.isPresent()) {
      return refused;
    }
    removeFoci(player.getInventory(), player, spell);
    removeFoci(player.getEnderChest(), player, spell);
    if (player.getInventory().firstEmpty() < 0) {
      return Optional.of(new Refusal.InventoryFull());
    }
    var key = new FocusKey(player.getUniqueId(), spell);
    var generation = state.foci().bind(key);
    storage
        .async()
        .logFailure(
            storage.store().saveFocus(key, generation), "recording a " + spell.id() + " bind");
    player.getInventory().addItem(items.focus(spell, player.getUniqueId(), generation));
    return Optional.empty();
  }

  private void removeFoci(Inventory inventory, Player owner, SpellKind spell) {
    for (var slot = 0; slot < inventory.getSize(); slot++) {
      var item = inventory.getItem(slot);
      if (item != null
          && items.identify(item).orElse(null) instanceof SpellIdentity.Focus focus
          && focus.spell() == spell
          && focus.owner().equals(owner.getUniqueId())) {
        inventory.setItem(slot, null);
      }
    }
  }
}
