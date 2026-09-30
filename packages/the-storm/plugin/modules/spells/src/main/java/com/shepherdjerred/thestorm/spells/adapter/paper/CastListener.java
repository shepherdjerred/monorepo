package com.shepherdjerred.thestorm.spells.adapter.paper;

import com.shepherdjerred.thestorm.spells.domain.FocusKey;
import com.shepherdjerred.thestorm.spells.domain.Refusal;
import com.shepherdjerred.thestorm.spells.domain.cast.CastMode;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.bukkit.event.Event;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerItemConsumeEvent;
import org.bukkit.inventory.EquipmentSlot;

/**
 * Casting. Right-clicking with a focus in the main hand casts its spell (the click never opens,
 * places or uses anything else). Reading a scroll to the end casts its spell, and the scroll is
 * consumed only if the spell goes off and no other plugin cancelled the read.
 */
final class CastListener implements Listener {

  private final SpellItems items;
  private final SpellState state;
  private final CastFlow flow;
  private final Say say;
  private final Map<UUID, CastFlow.Prepared> pending = new HashMap<>();

  CastListener(SpellItems items, SpellState state, CastFlow flow, Say say) {
    this.items = items;
    this.state = state;
    this.flow = flow;
    this.say = say;
  }

  @EventHandler(priority = EventPriority.HIGH)
  void onInteract(PlayerInteractEvent event) {
    var action = event.getAction();
    if (action != Action.RIGHT_CLICK_AIR && action != Action.RIGHT_CLICK_BLOCK) {
      return;
    }
    var item = event.getItem();
    if (item == null || event.useItemInHand() == Event.Result.DENY) {
      return;
    }
    if (!(items.identify(item).orElse(null) instanceof SpellIdentity.Focus focus)) {
      return;
    }
    event.setUseItemInHand(Event.Result.DENY);
    event.setUseInteractedBlock(Event.Result.DENY);
    if (event.getHand() != EquipmentSlot.HAND) {
      return;
    }
    var caster = event.getPlayer();
    if (!state.ready()) {
      say.refusal(caster, new Refusal.Loading());
      return;
    }
    if (!focus.owner().equals(caster.getUniqueId())) {
      say.refusal(caster, new Refusal.NotYourFocus());
      return;
    }
    if (!state
        .foci()
        .isCurrent(new FocusKey(caster.getUniqueId(), focus.spell()), focus.generation())) {
      caster.getInventory().setItemInMainHand(null);
      say.refusal(caster, new Refusal.StaleFocus());
      return;
    }
    flow.cast(caster, focus.spell(), CastMode.FOCUS, item);
  }

  /**
   * Reading a scroll, first half: the gates and the spell's preparation run before the game
   * consumes the scroll, and a refusal cancels the read so the scroll is kept.
   */
  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  void onRead(PlayerItemConsumeEvent event) {
    var identity = items.identify(event.getItem());
    if (identity.isEmpty()) {
      return;
    }
    var player = event.getPlayer();
    pending.remove(player.getUniqueId());
    if (!(identity.get() instanceof SpellIdentity.Scroll scroll)) {
      event.setCancelled(true);
      return;
    }
    flow.prepare(player, scroll.spell(), CastMode.SCROLL)
        .ifPresentOrElse(
            prepared -> pending.put(player.getUniqueId(), prepared),
            () -> event.setCancelled(true));
  }

  /**
   * Reading a scroll, second half: once no other plugin has cancelled the read, the spell goes off.
   * A cancelled read casts nothing and keeps the scroll.
   */
  @EventHandler(priority = EventPriority.MONITOR)
  void onReadDone(PlayerItemConsumeEvent event) {
    var prepared = pending.remove(event.getPlayer().getUniqueId());
    if (prepared != null && !event.isCancelled()) {
      flow.commit(prepared, event.getItem());
    }
  }
}
