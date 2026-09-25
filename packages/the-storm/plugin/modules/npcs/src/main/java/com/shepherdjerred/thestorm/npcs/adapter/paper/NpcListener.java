package com.shepherdjerred.thestorm.npcs.adapter.paper;

import com.shepherdjerred.thestorm.npcs.app.MarkerService;
import com.shepherdjerred.thestorm.npcs.app.NpcInteractEvent;
import com.shepherdjerred.thestorm.npcs.app.NpcRef;
import com.shepherdjerred.thestorm.npcs.app.NpcTalk;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.player.PlayerInteractEntityEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.world.EntitiesLoadEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.plugin.PluginManager;

/** Clicks on NPCs, NPC invulnerability, chunk loads and quits. */
final class NpcListener implements Listener {

  private final NpcWorld world;
  private final NpcTalk talk;
  private final MarkerService markers;
  private final PluginManager events;

  NpcListener(NpcWorld world, NpcTalk talk, MarkerService markers, PluginManager events) {
    this.world = world;
    this.talk = talk;
    this.markers = markers;
    this.events = events;
  }

  /** Right-clicking an NPC fires {@link NpcInteractEvent}, then opens its dialogue. */
  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  void onInteract(PlayerInteractEntityEvent event) {
    var npc = world.npcOf(event.getRightClicked());
    if (npc.isEmpty()) {
      return;
    }
    event.setCancelled(true);
    // The off hand fires a second event for the same click.
    if (event.getHand() != EquipmentSlot.HAND) {
      return;
    }
    var interact = new NpcInteractEvent(event.getPlayer(), NpcRef.of(npc.get()));
    events.callEvent(interact);
    if (!interact.isCancelled()) {
      talk.talk(event.getPlayer(), npc.get());
    }
  }

  /** NPCs are invulnerable even to creative players. */
  @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
  void onDamage(EntityDamageEvent event) {
    if (world.npcOf(event.getEntity()).isPresent()) {
      event.setCancelled(true);
    }
  }

  @EventHandler
  void onEntitiesLoad(EntitiesLoadEvent event) {
    world.entitiesLoaded(event.getEntities());
  }

  @EventHandler
  void onQuit(PlayerQuitEvent event) {
    talk.forget(event.getPlayer());
    markers.forget(event.getPlayer());
  }
}
