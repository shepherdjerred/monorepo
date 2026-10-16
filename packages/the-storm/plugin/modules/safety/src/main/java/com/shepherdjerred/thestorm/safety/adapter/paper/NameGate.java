package com.shepherdjerred.thestorm.safety.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.safety.ContentSafety;
import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.Set;
import net.kyori.adventure.text.Component;
import org.bukkit.GameMode;
import org.bukkit.Material;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.event.Event;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.inventory.PrepareAnvilEvent;
import org.bukkit.event.player.PlayerInteractEntityEvent;

/** New item/entity names remain invisible until approved. */
public final class NameGate implements Listener {
  private final ModuleContext context;
  private final ContentAdmission admission;
  private final Set<Event> replay = Collections.newSetFromMap(new IdentityHashMap<>());
  private final java.util.Map<java.util.UUID, java.util.UUID> anvilEdits =
      new java.util.HashMap<>();

  public NameGate(ModuleContext context, ContentSafety safety) {
    this.context = context;
    admission = new ContentAdmission(context, safety);
  }

  @EventHandler(priority = EventPriority.HIGHEST)
  public void anvil(PrepareAnvilEvent event) {
    if (!(event.getView().getPlayer() instanceof Player player)) return;
    var result = event.getResult();
    var rename = event.getView().getRenameText();
    if (result == null || rename == null || rename.isBlank()) return;
    var approved = result.clone();
    var view = event.getView();
    var inventory = event.getInventory();
    var first = inventory.getItem(0);
    var second = inventory.getItem(1);
    var input = first == null ? null : first.clone();
    var addition = second == null ? null : second.clone();
    var draft =
        new ContentAdmission.Draft(
            "item-name",
            "item-viewers",
            rename,
            approved.getItemMeta().getAsString(),
            "anvil:" + inventory.getLocation());
    var typed = admission.submission(player, draft);
    admission.observe(typed, "anvil-input");
    anvilEdits.put(player.getUniqueId(), typed.id());
    event.setResult(null);
    // Every keystroke is evidence, but only the settled name needs an external review.
    context
        .scheduler()
        .runOnMainThreadLater(
            java.time.Duration.ofMillis(300),
            () -> {
              if (!anvilEdits.remove(player.getUniqueId(), typed.id())) return;
              if (!player.isOnline()
                  || !player.getOpenInventory().equals(view)
                  || !rename.equals(view.getRenameText())) return;
              admission.publish(
                  player,
                  admission.submission(player, draft),
                  () -> {
                    if (!player.getOpenInventory().equals(view)
                        || !java.util.Objects.equals(input, inventory.getItem(0))
                        || !java.util.Objects.equals(addition, inventory.getItem(1))
                        || !rename.equals(view.getRenameText())) return "stale-edit";
                    inventory.setItem(2, approved);
                    return "anvil-name-approved";
                  });
            });
  }

  @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
  public void nameTag(PlayerInteractEntityEvent event) {
    if (replay.remove(event)) return;
    var player = event.getPlayer();
    var entity = event.getRightClicked();
    var original = player.getInventory().getItem(event.getHand()).clone();
    if (original.getType() != Material.NAME_TAG
        || !original.hasItemMeta()
        || !(entity instanceof LivingEntity)
        || entity instanceof Player) return;
    var name = original.getItemMeta().displayName();
    if (name == null) return;
    var previousName = entity.customName();
    event.setCancelled(true);
    var submission =
        admission.submission(
            player,
            new ContentAdmission.Draft(
                "entity-name",
                "entity-viewers",
                net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer.plainText()
                    .serialize(name),
                original.getItemMeta().getAsString(),
                entity.getUniqueId().toString()));
    admission.publish(
        player,
        submission,
        () -> {
          if (!usable(player, entity, original, event.getHand())
              || !java.util.Objects.equals(previousName, entity.customName())) return "stale-edit";
          var approved = new PlayerInteractEntityEvent(player, entity, event.getHand());
          replay.add(approved);
          try {
            context.plugin().getServer().getPluginManager().callEvent(approved);
          } finally {
            replay.remove(approved);
          }
          if (approved.isCancelled()) return "denied-by-entity-protection";
          if (!usable(player, entity, original, event.getHand())) return "stale-edit";
          entity.customName(name);
          if (player.getGameMode() != GameMode.CREATIVE) {
            var remainder = original.clone();
            remainder.setAmount(remainder.getAmount() - 1);
            player.getInventory().setItem(event.getHand(), remainder);
          }
          player.sendMessage(Component.text("Name approved."));
          return "entity-renamed";
        });
  }

  private static boolean usable(
      Player player,
      org.bukkit.entity.Entity entity,
      org.bukkit.inventory.ItemStack item,
      org.bukkit.inventory.EquipmentSlot hand) {
    return entity.isValid()
        && !entity.isDead()
        && entity.getWorld().equals(player.getWorld())
        && entity.getLocation().distanceSquared(player.getLocation()) <= 36
        && item.equals(player.getInventory().getItem(hand));
  }
}
