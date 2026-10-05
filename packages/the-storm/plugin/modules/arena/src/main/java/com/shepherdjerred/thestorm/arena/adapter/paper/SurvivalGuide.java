package com.shepherdjerred.thestorm.arena.adapter.paper;

import java.util.ArrayList;
import java.util.List;
import net.kyori.adventure.text.Component;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.inventory.meta.BookMeta;

/** Public rules remain available on demand; exploration rewards and loot odds stay undisclosed. */
final class SurvivalGuide {
  private final SurvivalRunner runner;

  SurvivalGuide(SurvivalRunner runner) {
    this.runner = runner;
  }

  private org.bukkit.inventory.ItemStack book() {
    var book = runner.items().stack(Material.WRITTEN_BOOK, 1);
    var pages =
        new ArrayList<String>(
            List.of(
                "Survive together\n\nChoose a class with your compass or /survival classes. Click the iron ready block or use /arena ready to toggle readiness. Everyone must be ready. Joining, changing class, or becoming unready cancels the ten-second countdown.",
                "Waves and revives\n\nDefeat every enemy to finish a round. The bar shows how many remain. Eight seconds separate rounds. Bosses arrive every five rounds. Solo runs grant one self-revive. In a team, hold sneak within three blocks of a downed survivor for five seconds. Keep line of sight.",
                "Gather and grow\n\nA nearby glint marks a resource you can harvest. Right-click it. Each material has two harvests per player per round, shared across its nodes. Sneak and right-click to upgrade a node for everyone after opening "
                    + district("foundry")
                    + " or "
                    + district("crypt")
                    + ". Upgrades cost 8 then 16 emeralds.",
                "Equipment and supplies\n\nWorkbenches and forges offer weapon, armor and supply tabs. Craft all four armor pieces, repair equipment, or enchant a held weapon. Supply stations offer varied food and potions. Repair barricades with planks and charge traps with iron and redstone.",
                "Your bank\n\nRight-click an ender chest terminal. Deposit supplies with one click: materials, arrows and emeralds belong to the team. Purchases spend carried supplies first, then the bank. Withdraw arrows to fire bows. Click inventory gear to store it privately. Your locker holds 54 slots and survives downs.",
                "Bank withdrawals\n\nSelect a team supply to withdraw up to one stack. The private locker holds your exact items, including enchantments and upgrades. Click a locker item to withdraw it. Rewards go to your locker if your inventory is full. Everything in the bank resets when the run ends; your private items disappear if you leave.",
                "Routes and power\n\nLocked route signs show the price. Click twice within three seconds to buy. Every player gains access. Restore power at "
                    + runner.map().powerDistrict()
                    + " with four iron and four redstone to enable most perk machines and the mystery box. The magenta beacon marks the active box.",
                "Perks and upgrades\n\nJuggernog increases health; Stamin-Up improves speed; Double Tap increases damage. Quick Revive speeds team revives or buys a solo self-revive. Perks are lost when downed. Pack-a-Punch repairs and upgrades a held weapon for 12, 24, then 36 emeralds.",
                "Power-ups\n\nWalk near a floating pickup to help the team. Max Ammo supplies 32 arrows to ranged survivors. Double Emeralds doubles kill rewards for 30 seconds. Insta-Kill defeats ordinary enemies in one hit for 15 seconds. Nuke clears ordinary enemies. Carpenter repairs barricades and heals two hearts.",
                "Bosses and travel\n\nMove away from marked ground before a spell lands. The Breeze Sovereign deflects ranged attacks: use melee during recovery. Watch glowing objectives during ritual and heart encounters. Find and install three plane parts to reach the offshore forge; later trips need fuel. Rounds continue while you travel.",
                "Leaving and watching\n\nUse /arena leave to exit. Your normal inventory is restored. Leaving does not bring run items home. Use /arena spec "
                    + runner.id()
                    + " to watch an active run. Class experience persists across normal games; debug games award no persistent progression."));
    for (var profile : runner.map().content().classes()) {
      pages.add(
          profile.role().name().toLowerCase(java.util.Locale.ROOT)
              + "\n\n"
              + profile.passive()
              + "\n\n"
              + profile.ability()
              + "\n\nUpgrades follow rounds 4, 9, and 14. Sneak and right-click your class compass to choose.");
    }
    book.editMeta(
        meta -> {
          var written = (BookMeta) meta;
          written.title(Component.text("Survivor's handbook"));
          written.author(Component.text("The Storm"));
          written.pages(pages.stream().flatMap(page -> paginate(page).stream()).toList());
        });
    return book;
  }

  private static List<Component> paginate(String text) {
    var pages = new ArrayList<Component>();
    var page = new StringBuilder();
    for (var word : com.google.common.base.Splitter.on(' ').split(text)) {
      if (page.length() + word.length() > 210) {
        pages.add(Component.text(page.toString()));
        page.setLength(0);
      }
      if (!page.isEmpty()) page.append(' ');
      page.append(word);
    }
    if (!page.isEmpty()) pages.add(Component.text(page.toString()));
    return pages;
  }

  private String district(String id) {
    return runner.map().content().zones().stream()
        .filter(zone -> zone.id().equals(id))
        .findFirst()
        .orElseThrow()
        .name();
  }

  void prepare() {
    if (!(runner.world().block(runner.map().content().lobbyGuide()).getState()
        instanceof org.bukkit.block.Lectern lectern))
      throw new IllegalStateException("Authored lobby lectern missing");
    lectern.getInventory().setItem(0, book());
  }

  void open(Player player) {
    player.openBook(book());
  }
}
