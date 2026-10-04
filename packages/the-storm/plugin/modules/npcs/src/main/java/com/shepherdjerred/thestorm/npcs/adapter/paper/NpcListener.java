package com.shepherdjerred.thestorm.npcs.adapter.paper;

import com.shepherdjerred.thestorm.core.text.HouseStyle;
import com.shepherdjerred.thestorm.npcs.app.MarkerService;
import com.shepherdjerred.thestorm.npcs.app.NpcInteractEvent;
import com.shepherdjerred.thestorm.npcs.app.NpcRef;
import com.shepherdjerred.thestorm.npcs.app.NpcTalk;
import net.kyori.adventure.text.Component;
import net.citizensnpcs.api.event.NPCRightClickEvent;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.EntityDeathEvent;
import org.bukkit.event.player.PlayerInteractEntityEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.world.EntitiesLoadEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.plugin.PluginManager;

/** NPC interactions, accepted attacks, next-dawn deaths, chunk loads and quits. */
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
    if (event.getRightClicked().hasMetadata("NPC")) return;
    var npc = world.npcOf(event.getRightClicked());
    if (npc.isEmpty()) {
      return;
    }
    event.setCancelled(true);
    // The off hand fires a second event for the same click.
    if (event.getHand() != EquipmentSlot.HAND) {
      return;
    }
    interact(event.getPlayer(), event.getRightClicked());
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  void onCitizensInteract(NPCRightClickEvent event) {
    if (world.npcOf(event.getNPC().getEntity()).isEmpty()) return;
    event.setCancelled(true);
    interact(event.getClicker(), event.getNPC().getEntity());
  }

  private void interact(Player player, Entity entity) {
    var npc = world.npcOf(entity).orElseThrow();
    if (!world.available(npc.id())) {
      player.sendMessage(HouseStyle.info(npc.name(), Component.text("I can't talk right now.")));
      return;
    }
    var interact = new NpcInteractEvent(player, NpcRef.of(npc));
    events.callEvent(interact);
    if (!interact.isCancelled()) {
      talk.talk(player, npc);
    }
  }

  /** Briefly protect saved entities while their combat state loads. */
  @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
  void onLoadingDamage(EntityDamageEvent event) {
    if (!world.ready() && world.npcOf(event.getEntity()).isPresent()) {
      // A saved NPC must not die before its durable absence can be recorded.
      event.setCancelled(true);
    }
  }

  /** Damage allowances apply only after startup state is available. */
  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onDamage(EntityDamageEvent event) {
    if (!world.ready() || event.getFinalDamage() <= 0) {
      return;
    }
    world
        .npcOf(event.getEntity())
        .ifPresent(
            npc ->
                NpcAttackers.attacker(event)
                    .ifPresent(
                        attacker -> {
                          var victim = (org.bukkit.entity.LivingEntity) event.getEntity();
                          world
                              .combat()
                              .hit(
                                  npc,
                                  victim,
                                  attacker,
                                  event.getFinalDamage() >= victim.getHealth());
                        }));
  }

  @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
  void onDeathDrops(EntityDeathEvent event) {
    if (world.npcOf(event.getEntity()).isPresent()) {
      event.getDrops().clear();
      event.setDroppedExp(0);
    }
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onDeath(EntityDeathEvent event) {
    world
        .npcOf(event.getEntity())
        .ifPresent(
            npc -> {
              world
                  .combat()
                  .died(
                      npc,
                      event.getEntity(),
                      NpcAttackers.attacker(event.getDamageSource())
                          .or(() -> java.util.Optional.ofNullable(event.getEntity().getKiller())));
              world.died(npc.id());
            });
  }

  @EventHandler
  void onEntitiesLoad(EntitiesLoadEvent event) {
    world.entitiesLoaded(event.getEntities());
  }

  @EventHandler
  void onQuit(PlayerQuitEvent event) {
    if (!com.shepherdjerred.thestorm.core.players.Humans.isHuman(event.getPlayer())) return;
    talk.forget(event.getPlayer());
    markers.forget(event.getPlayer());
  }
}
