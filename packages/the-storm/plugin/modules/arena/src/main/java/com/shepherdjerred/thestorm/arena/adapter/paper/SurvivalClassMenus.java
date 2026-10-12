package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.domain.survival.SurvivalBuild;
import com.shepherdjerred.thestorm.arena.domain.survival.SurvivalClass;
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

/** Readable lobby roles and explicit, irreversible run choices. Icons never leave the menu. */
final class SurvivalClassMenus {
  private record Choice(String name, Material icon, List<String> lore, Runnable action) {}

  private static final class Menu implements InventoryHolder {
    private final UUID owner;
    private final boolean upgrades;
    private final List<Choice> choices;
    private @Nullable Inventory inventory;

    Menu(UUID owner, boolean upgrades, List<Choice> choices) {
      this.owner = owner;
      this.upgrades = upgrades;
      this.choices = List.copyOf(choices);
    }

    @Override
    public Inventory getInventory() {
      return java.util.Objects.requireNonNull(inventory);
    }
  }

  private final SurvivalRunner runner;

  SurvivalClassMenus(SurvivalRunner runner) {
    this.runner = runner;
  }

  boolean isMenu(Inventory inventory) {
    return inventory.getHolder() instanceof Menu;
  }

  boolean owns(UUID id, Inventory inventory) {
    return inventory.getHolder() instanceof Menu menu
        && menu.owner.equals(id)
        && runner.game().player(id).isPresent()
        && (!menu.upgrades || runner.isFighter(id));
  }

  void classes(Player player) {
    var choices = new ArrayList<Choice>();
    for (var profile : runner.map().content().classes()) {
      var role = profile.role();
      var lore = new ArrayList<String>();
      lore.add(profile.passive());
      lore.add("Ability: " + profile.ability());
      profile.specializations().forEach(s -> lore.add(s.name() + ": " + s.description()));
      lore.add("Choose specialization after round 4; upgrades after 9 and 14.");
      lore.add(
          "Required XP: " + role.requiredXp() + " · Your XP: " + runner.xp(player.getUniqueId()));
      if (runner.game().player(player.getUniqueId()).orElseThrow().role() == role)
        lore.add("Currently selected");
      lore.add(
          (runner.game().debug() || role.unlocked(runner.xp(player.getUniqueId())))
              ? "Unlocked · select in lobby"
              : "Locked · " + runner.xp(player.getUniqueId()) + " / " + role.requiredXp() + " XP");
      choices.add(
          new Choice(
              role.name(),
              icon(role),
              lore,
              () -> {
                var failure =
                    runner.handle(
                        new com.shepherdjerred.thestorm.arena.domain.game.GameEvent.PickClass(
                            player.getUniqueId(), role.name(), true));
                failure.ifPresent(error -> Texts.error(player, error.name()));
                if (failure.isEmpty()) player.closeInventory();
              }));
    }
    open(player, false, "Classes · XP " + runner.xp(player.getUniqueId()), choices);
    runner
        .tips()
        .encounter(
            player,
            com.shepherdjerred.thestorm.arena.domain.survival.TutorialKey.of(
                com.shepherdjerred.thestorm.arena.domain.survival.TutorialKey.Topic.CLASSES));
  }

  void upgrades(Player player) {
    if (!runner.isFighter(player.getUniqueId())) {
      Texts.info(
          player, "Choose upgrades while standing in a run; /survival classes explains each role.");
      return;
    }
    var build = runner.talents().build(player.getUniqueId());
    var choices = new ArrayList<Choice>();
    if (build.pending() > 0 && build.specialization().isEmpty()) {
      var profile =
          runner.map().content().classes().stream()
              .filter(p -> p.role() == build.role())
              .findFirst()
              .orElseThrow();
      profile
          .specializations()
          .forEach(
              s ->
                  choices.add(
                      new Choice(
                          s.name(),
                          icon(build.role()),
                          List.of(
                              s.description(),
                              "Replaces your active ability for this run.",
                              "Click to choose; cannot respec during the run."),
                          () -> {
                            if (runner.talents().build(player.getUniqueId()).select(s.id()))
                              selected(player);
                          })));
    } else if (build.pending() > 0) {
      choices.add(
          new Choice(
              "Potency",
              Material.GLOWSTONE_DUST,
              List.of(
                  "+25% of base damage, healing, barrier or wolf damage.",
                  "Utility effects gain two seconds.", "Current Potency: " + build.potency()),
              () -> upgrade(player, SurvivalBuild.Upgrade.POTENCY)));
      choices.add(
          new Choice(
              "Tempo",
              Material.CLOCK,
              List.of(
                  "Ability recharges six seconds faster.",
                  "Current recharge: " + build.cooldownSeconds() + " seconds.",
                  "Current Tempo: " + build.tempo()),
              () -> upgrade(player, SurvivalBuild.Upgrade.TEMPO)));
    } else {
      choices.add(
          new Choice(
              "Your build",
              Material.BOOK,
              List.of(
                  build.role().name(),
                  build.specialization().map(Enum::name).orElse("Specialization after round 4"),
                  "Potency " + build.potency() + " · Tempo " + build.tempo(),
                  build.nextMilestone() == 0
                      ? "Build complete for this run."
                      : "Next choice after round " + build.nextMilestone()),
              () -> {}));
    }
    open(player, true, "Class upgrades · " + build.pending() + " ready", choices);
  }

  private void upgrade(Player player, SurvivalBuild.Upgrade upgrade) {
    if (runner.talents().build(player.getUniqueId()).upgrade(upgrade)) selected(player);
  }

  private void selected(Player player) {
    runner.feedback().play(player, SurvivalFeedback.Cue.UPGRADE);
    upgrades(player);
  }

  private void open(Player player, boolean upgrades, String title, List<Choice> choices) {
    var menu = new Menu(player.getUniqueId(), upgrades, choices);
    var inventory = runner.context().server().createInventory(menu, 27, Component.text(title));
    menu.inventory = inventory;
    for (var i = 0; i < choices.size(); i++) {
      var choice = choices.get(i);
      var icon = ItemStack.of(choice.icon());
      icon.editMeta(
          meta -> {
            meta.displayName(Component.text(choice.name()));
            meta.lore(
                choice.lore().stream()
                    .flatMap(line -> wrap(line).stream())
                    .map(Component::text)
                    .toList());
          });
      inventory.setItem(i, icon);
    }
    player.openInventory(inventory);
  }

  private static List<String> wrap(String text) {
    var lines = new ArrayList<String>();
    var line = new StringBuilder();
    for (var word : com.google.common.base.Splitter.on(' ').split(text)) {
      if (line.length() + word.length() > 46) {
        lines.add(line.toString());
        line.setLength(0);
      }
      if (!line.isEmpty()) line.append(' ');
      line.append(word);
    }
    if (!line.isEmpty()) lines.add(line.toString());
    return lines;
  }

  void click(Player player, Inventory inventory, int slot) {
    if (!owns(player.getUniqueId(), inventory)) {
      player.closeInventory();
      return;
    }
    var menu = (Menu) java.util.Objects.requireNonNull(inventory.getHolder());
    if (slot >= 0 && slot < menu.choices.size()) menu.choices.get(slot).action().run();
  }

  private static Material icon(SurvivalClass role) {
    return switch (role) {
      case FIGHTER -> Material.SHIELD;
      case RANGER -> Material.BOW;
      case MEDIC -> Material.GOLDEN_APPLE;
      case ENGINEER -> Material.ANVIL;
      case ALCHEMIST -> Material.BREWING_STAND;
      case BEASTMASTER -> Material.BONE;
    };
  }
}
