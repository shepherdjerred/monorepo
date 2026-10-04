package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.arena.domain.survival.SurvivalContent;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import org.bukkit.inventory.ItemStack;
import org.jspecify.annotations.Nullable;

/** Server-owned station menus; icon stacks are never transferable into a player's inventory. */
final class SurvivalMenus {
  private record Choice(String label, Material icon, Runnable buy) {}

  private static final class Menu implements InventoryHolder {
    private final UUID owner;
    private final BlockPos station;
    private final List<Choice> choices;
    private @Nullable Inventory inventory;

    Menu(UUID owner, BlockPos station, List<Choice> choices) {
      this.owner = owner;
      this.station = station;
      this.choices = List.copyOf(choices);
    }

    @Override
    public Inventory getInventory() {
      if (inventory == null) {
        throw new IllegalStateException("Menu is not built");
      }
      return inventory;
    }
  }

  private final SurvivalRunner runner;

  SurvivalMenus(SurvivalRunner runner) {
    this.runner = runner;
  }

  boolean owns(UUID id, Inventory inventory) {
    return inventory.getHolder() instanceof Menu menu
        && menu.owner.equals(id)
        && runner.isFighter(id)
        && runner.map().station(menu.station).isPresent();
  }

  void open(Player player, SurvivalContent.Station station) {
    if (!runner.isFighter(player.getUniqueId())) {
      return;
    }
    var choices = new ArrayList<Choice>();
    runner.map().content().recipes().stream()
        .filter(r -> r.station() == station.type())
        .forEach(
            recipe ->
                choices.add(
                    new Choice(
                        recipe.name() + " " + recipe.ingredients(),
                        SurvivalItems.material(recipe.material()),
                        () -> runner.actions().craft(player, recipe))));
    runner.fighters().stream()
        .filter(p -> !p.equals(player))
        .filter(p -> Places.at(p).distanceSquared(Places.at(player)) < 64)
        .forEach(
            target ->
                choices.add(
                    new Choice(
                        "Donate 8 emeralds to " + target.getName(),
                        Material.PLAYER_HEAD,
                        () -> runner.actions().donate(player, target, Material.EMERALD, 8))));
    if (choices.size() > 27) {
      throw new IllegalStateException("Station has too many choices");
    }
    var menu = new Menu(player.getUniqueId(), station.block(), choices);
    var inventory =
        runner.context().server().createInventory(menu, 27, Component.text(station.type().name()));
    menu.inventory = inventory;
    for (var i = 0; i < choices.size(); i++) {
      var choice = choices.get(i);
      var icon = ItemStack.of(choice.icon());
      icon.editMeta(meta -> meta.displayName(Component.text(choice.label())));
      inventory.setItem(i, icon);
    }
    player.openInventory(inventory);
  }

  boolean isMenu(Inventory inventory) {
    return inventory.getHolder() instanceof Menu;
  }

  void click(Player player, Inventory inventory, int slot) {
    if (!owns(player.getUniqueId(), inventory)) {
      player.closeInventory();
      return;
    }
    var menu = (Menu) java.util.Objects.requireNonNull(inventory.getHolder());
    if (Places.at(player)
            .distanceSquared(Places.location(runner.world().world(), menu.station.center()))
        > 36) {
      player.closeInventory();
      return;
    }
    if (slot >= 0 && slot < menu.choices.size()) {
      menu.choices.get(slot).buy().run();
    }
  }
}
