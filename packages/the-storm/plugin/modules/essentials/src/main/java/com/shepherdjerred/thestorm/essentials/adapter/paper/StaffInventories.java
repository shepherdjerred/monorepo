package com.shepherdjerred.thestorm.essentials.adapter.paper;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryCloseEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.jspecify.annotations.Nullable;

/**
 * Inventory inspection. Editing swaps one slot after audit; the displayed copy cannot yield items.
 */
final class StaffInventories implements Listener {
  record View(UUID target, Inventory source, Inventory display, boolean edit, String command) {}

  private record Edit(
      Player actor,
      UUID actorId,
      View view,
      int slot,
      @Nullable ItemStack cursor,
      @Nullable ItemStack previous) {}

  private final StaffCommands tools;
  private final Map<UUID, View> views = new HashMap<>();
  private final java.util.Set<UUID> busy = new java.util.HashSet<>();

  StaffInventories(StaffCommands tools) {
    this.tools = tools;
  }

  void register() {
    for (var name : List.of("invsee", "enderchest")) {
      tools.permission(name + ".edit");
      tools.add(name + " <player> [edit]", request -> open(request, name));
    }
  }

  private void open(StaffCommands.Request request, String command) {
    var target = tools.player(request.actor(), request.word(0));
    var actor = request.self();
    request.others(target);
    boolean edit = request.words().length > 1 && "edit".equals(request.word(1));
    if (request.words().length > 1 && !edit)
      throw new IllegalArgumentException("Use edit to request editing.");
    if (edit) request.require("thestorm.essentials." + command + ".edit");
    var source = "invsee".equals(command) ? target.getInventory() : target.getEnderChest();
    var display =
        tools
            .context
            .plugin()
            .getServer()
            .createInventory(
                null, 54, Component.text(target.getName() + (edit ? " — edit" : " — view")));
    actor.openInventory(display);
    views.put(actor.getUniqueId(), new View(target.getUniqueId(), source, display, edit, command));
    refresh(source, display);
  }

  @EventHandler
  void click(InventoryClickEvent event) {
    var view = views.get(event.getWhoClicked().getUniqueId());
    if (view == null) return;
    event.setCancelled(true);
    int slot = event.getRawSlot();
    if (!view.edit()
        || slot < 0
        || slot >= view.source().getSize()
        || !event.isLeftClick()
        || event.isShiftClick()) return;
    var actor = (Player) event.getWhoClicked();
    var id = actor.getUniqueId();
    if (!busy.add(id)) return;
    var cursor = copy(actor.getItemOnCursor());
    var previous = copy(view.source().getItem(slot));
    var edit = new Edit(actor, id, view, slot, cursor, previous);
    var audit =
        new com.shepherdjerred.thestorm.essentials.app.StaffStore.Audit(
            id.toString(),
            view.command() + ".edit",
            view.target() + ":" + slot,
            tools.context.time().instant());
    var _ =
        tools
            .state
            .commit(List.of(), audit)
            .thenCompose(
                _ ->
                    tools
                        .context
                        .services()
                        .require(com.shepherdjerred.thestorm.core.expansion.ManagedGameplay.class)
                        .enabled(
                            com.shepherdjerred.thestorm.core.expansion.ManagedGameplay.STAFF, id))
            .whenCompleteAsync(
                (enabled, failure) -> {
                  busy.remove(id);
                  finishEdit(edit, enabled, failure);
                },
                tools.context.scheduler().mainThread());
  }

  private void finishEdit(Edit edit, @Nullable Boolean enabled, @Nullable Throwable failure) {
    if (failure != null) {
      tools.context.logger().error("Inventory audit failed", failure);
      return;
    }
    if (!edit.actor().isOnline()) return;
    var target = tools.context.plugin().getServer().getPlayer(edit.view().target());
    if (target != null
        && !Objects.equals(liveInventory(target, edit.view().command()), edit.view().source())) {
      views.remove(edit.actorId(), edit.view());
      edit.actor().closeInventory();
      return;
    }
    if (!authorized(edit, target, enabled)) return;
    if (!Objects.equals(edit.cursor(), edit.actor().getItemOnCursor())
        || !Objects.equals(edit.previous(), edit.view().source().getItem(edit.slot()))) {
      refresh(edit.view().source(), edit.view().display());
      return;
    }
    edit.view().source().setItem(edit.slot(), edit.cursor());
    edit.actor().setItemOnCursor(edit.previous());
    refresh(edit.view().source(), edit.view().display());
  }

  private Inventory liveInventory(Player target, String command) {
    return "invsee".equals(command) ? target.getInventory() : target.getEnderChest();
  }

  private boolean authorized(Edit edit, @Nullable Player target, @Nullable Boolean enabled) {
    return Boolean.TRUE.equals(enabled)
        && tools.available(edit.actor(), edit.view().command())
        && target != null
        && StaffCommands.Request.allowsOthers(edit.actor(), edit.view().command(), target)
        && Objects.equals(views.get(edit.actorId()), edit.view())
        && edit.actor().hasPermission("thestorm.essentials." + edit.view().command() + ".edit");
  }

  private static @Nullable ItemStack copy(@Nullable ItemStack item) {
    return item == null ? null : item.clone();
  }

  private static void refresh(Inventory source, Inventory display) {
    for (int slot = 0; slot < source.getSize(); slot++)
      display.setItem(slot, copy(source.getItem(slot)));
  }

  @EventHandler
  void drag(InventoryDragEvent event) {
    if (views.containsKey(event.getWhoClicked().getUniqueId())) event.setCancelled(true);
  }

  @EventHandler
  void close(InventoryCloseEvent event) {
    views.remove(event.getPlayer().getUniqueId());
  }
}
