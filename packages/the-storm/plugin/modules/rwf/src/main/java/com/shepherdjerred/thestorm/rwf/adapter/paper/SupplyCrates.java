// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/killstreak/streaks/
// SupplyCrateKillstreak.java); see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.rwf.domain.killstreak.Delivery;
import com.shepherdjerred.thestorm.rwf.domain.match.Phase;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.data.Directional;
import org.bukkit.entity.Display;
import org.bukkit.entity.Player;
import org.bukkit.entity.TextDisplay;
import org.bukkit.inventory.ItemStack;

/**
 * Supply crates: a chest that lands where its owner called it, which only they may loot at first,
 * their team after 30 s and anyone after a minute, labelled above for each. Main thread only.
 */
final class SupplyCrates {

  /** The label stands this high over the crate's block: Red Warfare's hologram rows. */
  private static final double LABEL_HEIGHT = 1.5;

  /**
   * A landed supply crate.
   *
   * @param owner who called it in
   * @param ownerName their name, for the crate's label
   * @param team their team as it landed
   * @param landed when it landed
   * @param labels what the owner, their team and everyone else see above it
   */
  private record Crate(
      CombatantId owner,
      String ownerName,
      TeamColor team,
      Instant landed,
      List<TextDisplay> labels) {}

  private final MatchRunner runner;
  private final PaperContext context;
  private final Keys keys;
  private final StreakBlocks blocks;
  private final Map<BlockPos, Crate> crates = new HashMap<>();

  SupplyCrates(MatchRunner runner, PaperContext context, Keys keys, StreakBlocks blocks) {
    this.runner = runner;
    this.context = context;
    this.keys = keys;
    this.blocks = blocks;
  }

  /**
   * Why a crate cannot be called in on {@code target}, as Red Warfare told its owner: another
   * crate, landed or on its way ({@code falling}), next to it, or a bomb's column.
   */
  Optional<String> refusal(Block target, Collection<Location> falling) {
    var near =
        crates.keySet().stream()
                .anyMatch(at -> Delivery.crowded(at.x(), at.z(), target.getX(), target.getZ()))
            || falling.stream()
                .anyMatch(
                    at ->
                        Delivery.crowded(
                            at.getBlockX(), at.getBlockZ(), target.getX(), target.getZ()));
    if (near) {
      return Optional.of("Too close to another supply crate!");
    }
    var onBomb =
        runner.match().bombs().stream()
            .map(bomb -> bomb.site().position())
            .anyMatch(at -> at.x() == target.getX() && at.z() == target.getZ());
    return onBomb ? Optional.of("Cannot activate supplycrate on top of a bomb!") : Optional.empty();
  }

  /**
   * The crate lands on {@code block}: a chest facing as Red Warfare's random block data made it,
   * labelled for the owner, their team and everyone else.
   */
  void land(Player owner, CombatantId id, TeamColor team, Block block) {
    var chest = Material.CHEST.createBlockData();
    var roll = runner.match().random(runner.now()).nextInt(4);
    if (chest instanceof Directional facing) {
      facing.setFacing(BlockFace.valueOf(Delivery.crateFacing(roll)));
    }
    blocks.place(block, chest);
    var labels = new ArrayList<TextDisplay>();
    context.guarded(
        "label a supply crate",
        () -> labels.addAll(labels(owner, team, block.getLocation().add(0.5, LABEL_HEIGHT, 0.5))));
    crates.put(
        Places.pos(block), new Crate(id, owner.getName(), team, runner.now(), List.copyOf(labels)));
    relabel();
    owner.sendMessage(Component.text("Supply crate has landed!", NamedTextColor.BLUE));
  }

  /**
   * The owner's label, their team's, and everyone else's: the first two shown only to them, the
   * last to all but the team as it was when the crate landed.
   */
  private List<TextDisplay> labels(Player owner, TeamColor team, Location at) {
    var labels = new ArrayList<TextDisplay>();
    for (var i = 0; i < 3; i++) {
      var everyone = i == 2;
      labels.add(
          at.getWorld()
              .spawn(
                  at,
                  TextDisplay.class,
                  display -> {
                    display.setBillboard(Display.Billboard.CENTER);
                    display.setPersistent(false);
                    display.setVisibleByDefault(everyone);
                    keys.tagKitEntity(display);
                  }));
    }
    owner.showEntity(context.plugin(), labels.get(0));
    for (var member : runner.match().members()) {
      if (!member.team().filter(team::equals).isPresent()) {
        continue;
      }
      runner
          .entity(member.id())
          .ifPresent(
              viewer -> {
                if (!viewer.equals(owner)) {
                  viewer.showEntity(context.plugin(), labels.get(1));
                }
                viewer.hideEntity(context.plugin(), labels.get(2));
              });
    }
    return labels;
  }

  /**
   * Every half second: each label counts down to when its viewers may loot. The owner's always
   * reads "Lootable".
   */
  void relabel() {
    var now = runner.now();
    for (var crate : crates.values()) {
      if (crate.labels().size() < 3) {
        continue;
      }
      var since = Duration.between(crate.landed(), now);
      var title =
          Component.text(crate.ownerName() + "'s crate", Scoreboards.color(crate.team()))
              .decorate(TextDecoration.BOLD);
      crate.labels().get(0).text(title.appendNewline().append(status(Duration.ZERO, since)));
      crate
          .labels()
          .get(1)
          .text(title.appendNewline().append(status(Delivery.TEAM_LOOTS_AFTER, since)));
      crate
          .labels()
          .get(2)
          .text(title.appendNewline().append(status(Delivery.ANYONE_LOOTS_AFTER, since)));
    }
  }

  private static Component status(Duration wait, Duration since) {
    var color = since.compareTo(wait) >= 0 ? NamedTextColor.DARK_GREEN : NamedTextColor.RED;
    return Component.text(Delivery.crateStatus(wait, since), color).decorate(TextDecoration.BOLD);
  }

  /**
   * {@code player} right-clicked {@code block}: if it is a crate they may loot, they take one to
   * three steaks, one to three ender pearls until the endgame, and half the time an unbreakable
   * diamond chestplate unless they carry one, and the crate is gone. Returns whether the block is a
   * crate.
   */
  boolean loot(Player player, Block block) {
    var at = Places.pos(block);
    var crate = crates.get(at);
    if (crate == null) {
      return false;
    }
    var member = runner.memberOf(player.getUniqueId());
    if (member.isEmpty() || !runner.fighting(player.getUniqueId())) {
      return true;
    }
    var owner = member.orElseThrow().id().equals(crate.owner());
    var teammate = member.orElseThrow().team().filter(crate.team()::equals).isPresent();
    if (!Delivery.mayLoot(owner, teammate, Duration.between(crate.landed(), runner.now()))) {
      player.sendMessage(Component.text("This is not your supply crate!", NamedTextColor.RED));
      return true;
    }
    var endgame =
        runner.match().phase() instanceof Phase.Live live && live.poison().endGame(runner.now());
    var loot =
        Delivery.loot(
            runner.match().random(runner.now()),
            endgame,
            carries(player, Material.DIAMOND_CHESTPLATE));
    give(player, Material.COOKED_BEEF, loot.steak());
    give(player, Material.ENDER_PEARL, loot.pearls());
    if (loot.chestplate()) {
      var chestplate = ItemStack.of(Material.DIAMOND_CHESTPLATE);
      chestplate.editMeta(meta -> meta.setUnbreakable(true));
      keys.tag(chestplate);
      player.getInventory().addItem(chestplate);
    }
    player.sendMessage(
        owner
            ? Component.text("You've looted your Supply Crate!", NamedTextColor.GOLD)
            : Component.text("You've looted ", NamedTextColor.GOLD)
                .append(Component.text(crate.ownerName() + "'s", Scoreboards.color(crate.team())))
                .append(Component.text(" Supply Crate!", NamedTextColor.GOLD)));
    crates.remove(at);
    crate.labels().forEach(TextDisplay::remove);
    blocks.place(block, Material.AIR.createBlockData());
    return true;
  }

  /**
   * Whether {@code player} carries {@code material}, as Red Warfare looked: everything in their
   * inventory, worn armour and the off hand included. It looked on the cursor and in the crafting
   * grid too, which are always empty while a player can click a crate.
   */
  private static boolean carries(Player player, Material material) {
    var inventory = player.getInventory();
    for (var slot = 0; slot < inventory.getSize(); slot++) {
      var stack = inventory.getItem(slot);
      if (stack != null && stack.getType() == material) {
        return true;
      }
    }
    return false;
  }

  private void give(Player player, Material material, int amount) {
    if (amount <= 0) {
      return;
    }
    var stack = ItemStack.of(material, amount);
    keys.tag(stack);
    player.getInventory().addItem(stack);
  }

  /** Whether a crate stands at {@code at}, for tests. */
  boolean has(BlockPos at) {
    return crates.containsKey(at);
  }

  /** The match reset: every crate's labels go; the blocks are put back with the rest. */
  void reset() {
    crates.values().forEach(crate -> crate.labels().forEach(TextDisplay::remove));
    crates.clear();
  }
}
