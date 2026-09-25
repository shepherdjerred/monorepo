package com.shepherdjerred.thestorm.spells.adapter.paper;

import com.shepherdjerred.thestorm.spells.domain.FocusKey;
import com.shepherdjerred.thestorm.spells.domain.Refusal;
import com.shepherdjerred.thestorm.spells.domain.cast.CastMode;
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
 * consumed only if the spell goes off.
 */
final class CastListener implements Listener {

  private final SpellItems items;
  private final SpellState state;
  private final CastFlow flow;
  private final Say say;

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

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  void onConsume(PlayerItemConsumeEvent event) {
    var identity = items.identify(event.getItem());
    if (identity.isEmpty()) {
      return;
    }
    if (!(identity.get() instanceof SpellIdentity.Scroll scroll)
        || !flow.cast(event.getPlayer(), scroll.spell(), CastMode.SCROLL, event.getItem())) {
      event.setCancelled(true);
    }
  }
}
