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

  private enum Tab {
    WEAPONS,
    ARMOR,
    SUPPLIES
  }

  private enum Page {
    CRAFT,
    BANK,
    LOCKER,
    NODE
  }

  private static final class Menu implements InventoryHolder {
    private final UUID owner;
    private final BlockPos station;
    private final List<Choice> choices;
    private final Page page;
    private @Nullable Inventory inventory;

    Menu(UUID owner, BlockPos station, List<Choice> choices, Page page) {
      this.owner = owner;
      this.station = station;
      this.choices = List.copyOf(choices);
      this.page = page;
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
        && (menu.page == Page.NODE
            ? runner.map().resource(menu.station).isPresent()
            : runner.map().station(menu.station).isPresent());
  }

  void open(Player player, SurvivalContent.Station station) {
    if (!runner.isFighter(player.getUniqueId())) {
      return;
    }
    if (station.type() == SurvivalContent.StationType.BANK) {
      bank(player, station, Page.BANK);
      return;
    }
    open(
        player,
        station,
        station.type() == SurvivalContent.StationType.INFIRMARY ? Tab.SUPPLIES : Tab.WEAPONS);
  }

  private void open(Player player, SurvivalContent.Station station, Tab tab) {
    var choices = new ArrayList<Choice>();
    choices.add(
        new Choice("Weapons", Material.IRON_SWORD, () -> open(player, station, Tab.WEAPONS)));
    choices.add(
        new Choice("Armor", Material.IRON_CHESTPLATE, () -> open(player, station, Tab.ARMOR)));
    choices.add(
        new Choice(
            "Food, potions and supplies",
            Material.BREAD,
            () -> open(player, station, Tab.SUPPLIES)));
    runner.map().content().recipes().stream()
        .filter(r -> r.station() == station.type())
        .filter(r -> tab(SurvivalItems.material(r.material())) == tab)
        .forEach(
            recipe ->
                choices.add(
                    new Choice(
                        recipe.name()
                            + " · "
                            + recipe.ingredients().entrySet().stream()
                                .map(
                                    e ->
                                        e.getValue()
                                            + " "
                                            + SurvivalItems.name(
                                                SurvivalItems.material(e.getKey())))
                                .collect(java.util.stream.Collectors.joining(", ")),
                        SurvivalItems.material(recipe.material()),
                        () -> runner.actions().craft(player, recipe))));
    if (tab == Tab.WEAPONS) {
      choices.add(
          new Choice(
              "Repair held weapon · 2 iron + 2 emeralds",
              Material.ANVIL,
              () -> new SurvivalEquipment(runner).repair(player, false)));
      choices.add(
          new Choice(
              "Enchant held weapon · 4 glowstone + 4 emeralds",
              Material.ENCHANTED_BOOK,
              () -> new SurvivalEquipment(runner).enchant(player)));
    } else if (tab == Tab.ARMOR)
      choices.add(
          new Choice(
              "Repair armor · 4 iron + 4 emeralds",
              Material.ANVIL,
              () -> new SurvivalEquipment(runner).repair(player, true)));
    if (choices.size() > 27) {
      throw new IllegalStateException("Station has too many choices");
    }
    var menu = new Menu(player.getUniqueId(), station.block(), choices, Page.CRAFT);
    var inventory =
        runner
            .context()
            .server()
            .createInventory(
                menu, 27, Component.text(SurvivalPresentation.stationName(station.type())));
    menu.inventory = inventory;
    for (var i = 0; i < choices.size(); i++) {
      var choice = choices.get(i);
      var icon = ItemStack.of(choice.icon());
      icon.editMeta(meta -> meta.displayName(Component.text(choice.label())));
      inventory.setItem(i, icon);
    }
    player.openInventory(inventory);
  }

  private static Tab tab(Material material) {
    if (SurvivalItems.armorSlot(material).isPresent()) return Tab.ARMOR;
    var name = material.name();
    if (name.endsWith("_SWORD")
        || name.endsWith("_AXE")
        || name.endsWith("_SPEAR")
        || java.util.Set.of(
                Material.BOW, Material.CROSSBOW, Material.TRIDENT, Material.MACE, Material.SHIELD)
            .contains(material)) return Tab.WEAPONS;
    return Tab.SUPPLIES;
  }

  private void bank(Player player, SurvivalContent.Station station, Page page) {
    var choices = new ArrayList<Choice>();
    var items = runner.items();
    if (page == Page.BANK) {
      choices.add(
          new Choice(
              "Deposit supplies · shared with your team",
              Material.CHEST,
              () -> {
                Texts.info(
                    player, "Deposited " + items.deposit(player) + " supplies for the team.");
                runner.feedback().play(player, SurvivalFeedback.Cue.PURCHASE);
              }));
      choices.add(
          new Choice(
              "Private locker · click inventory items to store",
              Material.ENDER_CHEST,
              () -> bank(player, station, Page.LOCKER)));
      var resources =
          runner.map().content().zones().stream()
              .flatMap(z -> z.resources().stream())
              .map(SurvivalContent.Resource::material)
              .collect(java.util.stream.Collectors.toCollection(java.util.TreeSet::new));
      resources.add("EMERALD");
      resources.add("ARROW");
      for (var resource : resources) {
        var material = SurvivalItems.material(resource);
        var balance = items.bank().supplies().count(resource);
        choices.add(
            new Choice(
                SurvivalItems.name(material) + " · Team: " + balance,
                material,
                () -> {
                  var amount =
                      Math.min(material.getMaxStackSize(), items.bank().supplies().count(resource));
                  if (amount == 0 || !items.withdraw(player, material, amount))
                    Texts.error(player, "Make room, or this supply has been withdrawn.");
                  else runner.feedback().play(player, SurvivalFeedback.Cue.PURCHASE);
                }));
      }
    }
    var menu = new Menu(player.getUniqueId(), station.block(), choices, page);
    var inventory =
        runner
            .context()
            .server()
            .createInventory(
                menu,
                page == Page.LOCKER ? 54 : 27,
                Component.text(
                    page == Page.LOCKER
                        ? "Your locker · click to withdraw"
                        : "Team supplies · purchases use these"));
    menu.inventory = inventory;
    fillBank(player, inventory, page, choices);
    player.openInventory(inventory);
  }

  private void fillBank(Player player, Inventory inventory, Page page, List<Choice> choices) {
    if (page == Page.LOCKER) {
      inventory.setContents(runner.items().bank().contents(player.getUniqueId()));
      return;
    }
    for (var i = 0; i < choices.size(); i++) {
      var choice = choices.get(i);
      var icon = ItemStack.of(choice.icon());
      icon.editMeta(meta -> meta.displayName(Component.text(choice.label())));
      inventory.setItem(i, icon);
    }
  }

  void store(Player player, Inventory inventory, int slot) {
    if (!valid(player, inventory)) return;
    var menu = (Menu) java.util.Objects.requireNonNull(inventory.getHolder());
    if (menu.page != Page.BANK && menu.page != Page.LOCKER) return;
    if (!runner.items().store(player, slot))
      Texts.error(player, "This item cannot be stored, or your locker is full.");
    else runner.feedback().play(player, SurvivalFeedback.Cue.PURCHASE);
    bank(player, runner.map().station(menu.station).orElseThrow(), menu.page);
  }

  boolean isMenu(Inventory inventory) {
    return inventory.getHolder() instanceof Menu;
  }

  void resource(Player player, SurvivalContent.Resource node) {
    var state = runner.map().state();
    var price = state.resourceTier(node) * 8;
    var choices =
        List.of(
            new Choice(
                "Harvest · " + state.harvestAmount(node) + " supplies",
                SurvivalItems.material(node.material()),
                () -> runner.actions().gather(player, node)),
            new Choice(
                state.resourceTier(node) == 3
                    ? "Fully upgraded"
                    : "Improve yield · " + price + " emeralds",
                Material.EXPERIENCE_BOTTLE,
                () -> runner.actions().upgradeNode(player, node)));
    var menu = new Menu(player.getUniqueId(), node.block(), choices, Page.NODE);
    var inventory =
        runner
            .context()
            .server()
            .createInventory(
                menu,
                9,
                Component.text(SurvivalItems.name(SurvivalItems.material(node.material()))));
    menu.inventory = inventory;
    fillBank(player, inventory, Page.NODE, choices);
    player.openInventory(inventory);
  }

  void click(Player player, Inventory inventory, int slot) {
    if (!valid(player, inventory)) return;
    var menu = (Menu) java.util.Objects.requireNonNull(inventory.getHolder());
    if (menu.page == Page.LOCKER) {
      if (!runner.items().withdraw(player, slot))
        Texts.error(player, "Make room in your inventory first.");
    } else if (slot >= 0 && slot < menu.choices.size()) {
      menu.choices.get(slot).buy().run();
    }
    if ((menu.page == Page.BANK || menu.page == Page.LOCKER)
        && player.getOpenInventory().getTopInventory().equals(inventory))
      bank(player, runner.map().station(menu.station).orElseThrow(), menu.page);
    if (menu.page == Page.NODE) resource(player, runner.map().resource(menu.station).orElseThrow());
  }

  private boolean valid(Player player, Inventory inventory) {
    if (!owns(player.getUniqueId(), inventory)) {
      player.closeInventory();
      return false;
    }
    var menu = (Menu) java.util.Objects.requireNonNull(inventory.getHolder());
    if (Places.at(player)
            .distanceSquared(Places.location(runner.world().world(), menu.station.center()))
        > 36) {
      player.closeInventory();
      return false;
    }
    return true;
  }
}
