package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.killstreak.Killstreak;
import com.shepherdjerred.thestorm.rwf.domain.killstreak.StreakLoadout;
import java.util.EnumSet;
import java.util.List;
import java.util.Optional;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Material;
import org.bukkit.Server;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import org.bukkit.inventory.ItemStack;

/** An editable draft; only an explicit save changes a combatant's persistent rewards. */
final class StreakMenu implements InventoryHolder {
  static final int SIZE = 27;
  static final int SAVE = 22;
  static final int BACK = 18;
  private static final List<Killstreak> REWARDS = List.of(Killstreak.values());
  private final Inventory inventory;
  private final EnumSet<Killstreak> selected;

  private StreakMenu(Server server, StreakLoadout loadout) {
    selected = EnumSet.copyOf(loadout.rewards());
    inventory =
        server.createInventory(
            this, SIZE, Component.text("Choose three killstreaks", NamedTextColor.DARK_BLUE));
    inventory.setItem(
        BACK,
        icon(Material.ARROW, "Back to kits", List.of("Your unsaved changes are discarded"), false));
    draw();
  }

  static void open(Server server, Player player, StreakLoadout loadout) {
    player.openInventory(new StreakMenu(server, loadout).inventory);
  }

  Optional<Killstreak> rewardAt(int slot) {
    return slot >= 10 && slot < 10 + REWARDS.size()
        ? Optional.of(REWARDS.get(slot - 10))
        : Optional.empty();
  }

  void toggle(Killstreak reward) {
    if (selected.remove(reward)) {
      draw();
      return;
    }
    selected.removeIf(existing -> existing.kills() == reward.kills());
    if (selected.size() < StreakLoadout.SIZE) {
      selected.add(reward);
    }
    draw();
  }

  Optional<StreakLoadout> selection() {
    return selected.size() == StreakLoadout.SIZE
        ? Optional.of(new StreakLoadout(List.copyOf(selected)))
        : Optional.empty();
  }

  private void draw() {
    for (var i = 0; i < REWARDS.size(); i++) {
      var reward = REWARDS.get(i);
      inventory.setItem(
          10 + i,
          icon(
              Material.valueOf(reward.item()),
              reward.look().name(),
              List.of(
                  reward.kills() + " kills, including assist shares",
                  selected.contains(reward)
                      ? "Selected: click to remove"
                      : "Click to select; remove a reward if full",
                  "One reward per threshold, once per life"),
              selected.contains(reward)));
    }
    inventory.setItem(
        SAVE,
        icon(
            selected.size() == StreakLoadout.SIZE ? Material.LIME_WOOL : Material.GRAY_WOOL,
            "Save " + selected.size() + " / 3 rewards",
            List.of(
                "Changes apply before the round starts", "Preferences are kept for future matches"),
            false));
  }

  private static ItemStack icon(
      Material material, String name, List<String> lore, boolean selected) {
    var stack = ItemStack.of(material);
    stack.editMeta(
        meta -> {
          meta.displayName(
              Component.text(name, NamedTextColor.GOLD).decoration(TextDecoration.ITALIC, false));
          meta.lore(
              lore.stream()
                  .map(
                      line ->
                          (Component)
                              Component.text(line, NamedTextColor.GRAY)
                                  .decoration(TextDecoration.ITALIC, false))
                  .toList());
          meta.setEnchantmentGlintOverride(selected);
        });
    return stack;
  }

  @Override
  public Inventory getInventory() {
    return inventory;
  }
}
