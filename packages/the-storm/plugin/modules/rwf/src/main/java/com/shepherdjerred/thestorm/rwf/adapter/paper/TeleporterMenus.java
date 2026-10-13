// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/abilities/
// TeleporterInventory.java and TeleporterAbility.java, onInteractRemote); see
// packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityInput;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitText;
import com.shepherdjerred.thestorm.rwf.domain.ability.Placed;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Teleporter;
import com.shepherdjerred.thestorm.rwf.domain.bomb.Bomb;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitBook;
import com.shepherdjerred.thestorm.rwf.domain.kit.SafeTeleport;
import com.shepherdjerred.thestorm.rwf.domain.match.Combatant;
import java.text.DecimalFormat;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.TextDecoration;
import net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Tag;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryCloseEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import org.bukkit.inventory.ItemStack;
import org.jspecify.annotations.Nullable;

/**
 * The Teleporter's Remote Teleporter, as Red Warfare's {@code TeleporterInventory}: it opens only
 * once the remote has recharged, and then shows the living teammates by name, each with their kit
 * and how far they stand from the Teleporter and from every bomb the map placed, rebuilt every half
 * second while it is open. A click establishes a teleporter under that teammate and closes the
 * menu; the red wool after them breaks every teleporter of the Teleporter's and closes it. A
 * refused click leaves it open. Main thread only.
 */
final class TeleporterMenus implements Listener {

  private static final DecimalFormat DISTANCE = new DecimalFormat("#.#");

  private static final LegacyComponentSerializer LEGACY = LegacyComponentSerializer.legacySection();

  /** Red Warfare rebuilt the menu on its half-second clock. */
  private static final Duration REBUILD = Duration.ofMillis(500);

  private final MatchRunner runner;
  private final PaperContext context;
  private final KitFactory kits;

  TeleporterMenus(MatchRunner runner, PaperContext context, KitFactory kits) {
    this.runner = runner;
    this.context = context;
    this.kits = kits;
  }

  /** The menu: which teammate each slot stands for. */
  static final class Menu implements InventoryHolder {

    private final Inventory inventory;
    private final Map<Integer, CombatantId> slots = new HashMap<>();
    private int destroy = -1;
    private @Nullable Cancellable rebuild;

    private Menu(PaperContext context, int size) {
      this.inventory =
          context.server().createInventory(this, size, Component.text("Teleporter Inventory"));
    }

    @Override
    public Inventory getInventory() {
      return inventory;
    }
  }

  /** Opens the remote for {@code player}, if it has recharged. */
  void open(Player player) {
    var self = runner.memberOf(player.getUniqueId()).orElseThrow();
    if (!runner.match().abilities().ready(self.id(), Teleporter.REMOTE, runner.now())) {
      Classic.say(player, KitText.RED + "You cannot do another remote teleporter this soon!");
      return;
    }
    var mates = mates(player);
    var rows = Math.max(1, (mates.size() + 8) / 9 + 1);
    var menu = new Menu(context, Math.min(54, rows * 9));
    fill(menu, player);
    player.openInventory(menu.inventory);
    menu.rebuild =
        context.scheduler().repeatOnMainThread(REBUILD, REBUILD, () -> rebuild(menu, player));
  }

  private void rebuild(Menu menu, Player player) {
    if (!runner.live() || !menu.inventory.getViewers().contains(player)) {
      stop(menu);
      return;
    }
    fill(menu, player);
  }

  private static void stop(Menu menu) {
    if (menu.rebuild != null) {
      menu.rebuild.cancel();
      menu.rebuild = null;
    }
  }

  /** The living teammates of {@code player}, by name regardless of case. */
  private List<Player> mates(Player player) {
    var self = runner.memberOf(player.getUniqueId()).orElseThrow();
    var mates = new ArrayList<Player>();
    for (var member : runner.match().members()) {
      if (member.alive()
          && !member.id().equals(self.id())
          && member.onTeam(self.team().orElseThrow())) {
        runner.entity(member.id()).ifPresent(mates::add);
      }
    }
    mates.sort(Comparator.comparing(p -> p.getName().toLowerCase(Locale.ROOT)));
    return mates;
  }

  private void fill(Menu menu, Player player) {
    menu.inventory.clear();
    menu.slots.clear();
    var self = runner.memberOf(player.getUniqueId()).orElseThrow();
    var team = self.team().orElseThrow();
    var bombs = new ArrayList<>(runner.match().bombs());
    bombs.sort(Comparator.comparing(TeleporterMenus::bombName, String.CASE_INSENSITIVE_ORDER));
    var mates = mates(player);
    for (var i = 0; i < mates.size() && i < menu.inventory.getSize() - 9; i++) {
      var mate = mates.get(i);
      var member = runner.memberOf(mate.getUniqueId()).orElseThrow();
      var kit = KitBook.byId(member.kit().orElseThrow()).orElseThrow();
      var lore = new ArrayList<Component>();
      lore.add(line(KitText.BLUE + "Kit: §f" + kit.name()));
      lore.add(
          line(
              KitText.BLUE
                  + "Distance: §f"
                  + DISTANCE.format(Places.at(mate).distance(Places.at(player)))));
      for (var bomb : bombs) {
        var at = corner(bomb.site().position());
        lore.add(
            line(
                KitText.BLUE
                    + "Distance from "
                    + bomb.team().map(t -> KitText.team(t) + t.displayName()).orElse("nuke")
                    + ": §f"
                    + DISTANCE.format(at.distance(Places.at(mate)))));
      }
      lore.add(Component.empty());
      lore.add(line(KitText.GREEN + "§lClick to establish teleporter"));
      var icon = kits.icon(kit, false);
      icon.editMeta(
          meta -> {
            meta.displayName(line(KitText.team(team) + mate.getName()));
            meta.lore(lore);
          });
      menu.inventory.setItem(i, icon);
      menu.slots.put(i, member.id());
    }
    menu.destroy = menu.inventory.getSize() - 1;
    var wool = ItemStack.of(Material.RED_WOOL);
    wool.editMeta(meta -> meta.displayName(line(KitText.RED + "Destroy Teleporters")));
    menu.inventory.setItem(menu.destroy, wool);
  }

  /** Red Warfare sorted the bombs by their team's name, a nuke as "Nuke". */
  private static String bombName(Bomb bomb) {
    return bomb.team().map(t -> t.displayName()).orElse("Nuke");
  }

  private Location corner(com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos pos) {
    return new Location(context.mapWorld(), pos.x(), pos.y(), pos.z());
  }

  private static Component line(String text) {
    return LEGACY.deserialize(text).decoration(TextDecoration.ITALIC, false);
  }

  @EventHandler(priority = EventPriority.LOWEST)
  void onClick(InventoryClickEvent event) {
    if (!(event.getView().getTopInventory().getHolder() instanceof Menu menu)) {
      return;
    }
    event.setCancelled(true);
    if (!(event.getWhoClicked() instanceof Player player)
        || event.getRawSlot() < 0
        || event.getRawSlot() >= menu.inventory.getSize()
        || !runner.fighting(player.getUniqueId())
        || !runner.live()) {
      return;
    }
    var done =
        event.getRawSlot() == menu.destroy
            ? destroy(player)
            : Optional.ofNullable(menu.slots.get(event.getRawSlot()))
                .map(mate -> establish(player, mate))
                .orElse(false);
    if (done) {
      stop(menu);
      later(player::closeInventory);
    }
  }

  @EventHandler(priority = EventPriority.LOWEST)
  void onDrag(InventoryDragEvent event) {
    if (event.getView().getTopInventory().getHolder() instanceof Menu) {
      event.setCancelled(true);
    }
  }

  @EventHandler
  void onClose(InventoryCloseEvent event) {
    if (event.getInventory().getHolder() instanceof Menu menu) {
      stop(menu);
    }
  }

  private void later(Runnable work) {
    context.scheduler().runOnMainThread(work);
  }

  /**
   * A teleporter under {@code mate}, if they stand somewhere it can go; whether one was
   * established.
   */
  boolean establish(Player player, CombatantId mate) {
    if (!runner.fighting(mate.uuid())) {
      return false;
    }
    var target = runner.entity(mate);
    if (target.isEmpty()) {
      return false;
    }
    var at = Places.at(target.orElseThrow());
    var world = at.getWorld();
    var below = at.getBlock().getRelative(BlockFace.DOWN);
    if (!SafeTeleport.safe(
            Places.pos(at), world.getMinHeight(), pos -> footing(Places.block(world, pos)))
        || !Classic.solid(below)) {
      Classic.say(player, KitText.BLUE + "Your target is not in a valid space!");
      return false;
    }
    var pos = Places.pos(below);
    var site =
        new AbilityInput.Site(
            true,
            TeleporterClicks.nearBomb(runner, pos),
            true,
            true,
            TeleporterClicks.valid(below));
    runner
        .kits()
        .act(
            player,
            new AbilityInput.PlaceTeleporter(
                pos, Optional.of(mate), at.distance(Places.at(player)), site));
    var self = runner.memberOf(player.getUniqueId()).map(Combatant::id);
    return runner
        .match()
        .abilities()
        .placedAt(pos)
        .filter(p -> p instanceof Placed.Teleporter t && self.filter(t.owner()::equals).isPresent())
        .isPresent();
  }

  /** What {@code block} is to a player landing there, as Red Warfare's {@code isSafeTeleport}. */
  private static SafeTeleport.Footing footing(Block block) {
    var type = block.getType();
    if (Tag.PRESSURE_PLATES.isTagged(type) || type == Material.TRIPWIRE) {
      return SafeTeleport.Footing.TRAP;
    }
    if (Classic.open(block)) {
      return SafeTeleport.Footing.CLEAR;
    }
    return SafeTeleport.Footing.STANDABLE;
  }

  /** Breaks every teleporter of {@code player}'s through the remote; whether there were any. */
  private boolean destroy(Player player) {
    var self = runner.memberOf(player.getUniqueId()).orElseThrow();
    var distance = 0.0;
    var any = false;
    for (var placed : runner.match().abilities().placed()) {
      if (placed instanceof Placed.Teleporter t && t.owner().equals(self.id())) {
        distance += Places.at(player).distance(corner(t.block()));
        any = true;
      }
    }
    runner.kits().act(player, new AbilityInput.DestroyTeleporters(distance));
    return any;
  }

  /** Whether {@code holder} is a remote menu. */
  static boolean isMenu(@Nullable InventoryHolder holder) {
    return holder instanceof Menu;
  }
}
