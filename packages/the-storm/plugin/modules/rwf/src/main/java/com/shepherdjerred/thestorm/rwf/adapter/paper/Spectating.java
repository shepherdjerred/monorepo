// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/misc/SpectatorInventory.java,
// redwarfare-arcade/src/me/libraryaddict/arcade/managers/GameManager.java, onCompassInteract, and
// redwarfare-arcade/src/me/libraryaddict/arcade/commands/CommandGoTo.java); see
// packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.destroystokyo.paper.event.player.PlayerStopSpectatingEntityEvent;
import com.shepherdjerred.thestorm.core.snapshot.PlayerStates;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitBook;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEffect;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Consumer;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import org.bukkit.inventory.ItemStack;

/**
 * Red Warfare's spectator tools for the dead. A fallen member watches from their killer's eyes for
 * {@link #KILLER_VIEW}, then flies over the map as an unseen ghost holding the compass: a
 * left-click jumps to a random living fighter, a right-click opens the player menu, grouped by
 * team, where a team's header jumps to its bomb and each fighter shows their kit, kills and health.
 * {@code /rwf spectate next|previous} follows a fighter in first person; letting go returns to the
 * ghost. Enemy stealth kits cannot be jumped to. With the spectator tools flag off, the dead watch
 * in plain spectator mode from the spectator point, as before. Main thread only.
 */
final class Spectating implements Listener {

  /** How long a fallen member sees through their killer's eyes. */
  static final Duration KILLER_VIEW = Duration.ofSeconds(3);

  /** The hotbar slot of the compass. */
  static final int COMPASS_SLOT = 0;

  /**
   * The hotbar slot of the kit layout item, beside the compass as the original's addItem put it.
   */
  static final int KIT_LAYOUT_SLOT = 1;

  /** The hotbar slot of the "Join next game" item. */
  static final int NEXT_GAME_SLOT = 8;

  /** Opens the kit layout editor for a player; absent until kits have layouts to edit. */
  private Optional<Consumer<Player>> kitLayouts = Optional.empty();

  private final MatchRunner runner;
  private final Watchers watchers;
  private final Keys keys;
  private final PaperContext context;
  private final Set<UUID> ghosts = new HashSet<>();
  private final Map<UUID, Instant> killerView = new HashMap<>();
  private final Map<UUID, UUID> killers = new HashMap<>();

  Spectating(MatchRunner runner, Watchers watchers, Keys keys, PaperContext context) {
    this.runner = runner;
    this.watchers = watchers;
    this.keys = keys;
    this.context = context;
  }

  /** A death: the killer is remembered for the victim's first look. */
  void death(MatchEffect.Death death) {
    death
        .attribution()
        .killer()
        .ifPresent(killer -> killers.put(death.victim().uuid(), killer.uuid()));
  }

  /**
   * {@code player} died and now watches: through their killer's eyes first, then as a ghost at a
   * random spot over the map. Returns false when the tools are off and the caller should spectate
   * the plain way.
   */
  boolean spectate(Player player, Location at) {
    if (!runner.features().spectatorTools()) {
      return false;
    }
    var id = player.getUniqueId();
    ghost(player, randomSpot(at));
    var killer =
        Optional.ofNullable(killers.remove(id))
            .flatMap(uuid -> Optional.ofNullable(context.server().getPlayer(uuid)))
            .filter(p -> runner.fighting(p.getUniqueId()));
    killer.ifPresent(
        target -> {
          player.setGameMode(GameMode.SPECTATOR);
          runner.move(player, Places.at(target));
          player.setSpectatorTarget(target);
          killerView.put(id, runner.now().plus(KILLER_VIEW));
        });
    return true;
  }

  /** A random spot to start watching from: the spectator point or one of the team spawns. */
  private Location randomSpot(Location spectatorPoint) {
    var map = runner.currentMap();
    if (map.isEmpty()) {
      return spectatorPoint;
    }
    var spots = new ArrayList<Location>();
    spots.add(spectatorPoint);
    for (var team : map.orElseThrow().definition().teams()) {
      for (var spawn : team.spawns()) {
        spots.add(Places.location(context.mapWorld(), spawn).add(0, 4, 0));
      }
    }
    return spots.get(context.random().nextInt(spots.size()));
  }

  /** {@code player} becomes an unseen, flying ghost holding the compass. */
  private void ghost(Player player, Location at) {
    var id = player.getUniqueId();
    ghosts.add(id);
    PlayerStates.wipe(player, GameMode.ADVENTURE);
    player.setAllowFlight(true);
    runner.move(player, at);
    player.setFlying(true);
    player.setInvulnerable(true);
    player.setCollidable(false);
    // GameTeam#setDead: the compass, the kit layout item when there are layouts to edit, and the
    // next game item in the last slot.
    player.getInventory().setItem(COMPASS_SLOT, compass());
    if (kitLayouts.isPresent()) {
      player.getInventory().setItem(KIT_LAYOUT_SLOT, kitLayoutItem());
    }
    player.getInventory().setItem(NEXT_GAME_SLOT, nextGameItem());
    hideFromTheLiving(player);
  }

  /** Lets the dead edit their kit layouts with the original's star; PR D's layout editor. */
  void kitLayouts(Consumer<Player> editor) {
    kitLayouts = Optional.of(editor);
  }

  /** GameManager's spectator compass, word for word. */
  private ItemStack compass() {
    var stack = new ItemStack(Material.COMPASS);
    stack.editMeta(
        meta -> {
          meta.displayName(
              Component.text("Spectator Compass", NamedTextColor.GRAY)
                  .decoration(TextDecoration.ITALIC, false));
          meta.lore(
              List.of(
                  clickLore("LEFT-CLICK ", "to teleport to nearby player"),
                  clickLore("RIGHT-CLICK ", "to open a menu")));
        });
    keys.tagCompass(stack);
    return stack;
  }

  private static Component clickLore(String click, String what) {
    return Component.text(click, NamedTextColor.BLUE, TextDecoration.BOLD)
        .append(Component.text(what, NamedTextColor.BLUE).decoration(TextDecoration.BOLD, false))
        .decoration(TextDecoration.ITALIC, false);
  }

  /** GameManager's "Join next game" quartz. */
  private ItemStack nextGameItem() {
    var stack = new ItemStack(Material.QUARTZ);
    stack.editMeta(
        meta ->
            meta.displayName(
                Component.text("Join next game", NamedTextColor.BLUE)
                    .decoration(TextDecoration.ITALIC, false)));
    keys.tagNextGame(stack);
    return stack;
  }

  /** GameManager's "Change kit layout" star. */
  private ItemStack kitLayoutItem() {
    var stack = new ItemStack(Material.NETHER_STAR);
    stack.editMeta(
        meta -> {
          meta.displayName(
              Component.text("Change kit layout", NamedTextColor.DARK_GREEN)
                  .decoration(TextDecoration.ITALIC, false));
          meta.lore(
              List.of(
                  Component.text(
                          "Right click with this to change the kit layouts!", NamedTextColor.GREEN)
                      .decoration(TextDecoration.ITALIC, false)));
        });
    keys.tagKitLayout(stack);
    return stack;
  }

  /**
   * The dead's other items. The original's "Join next game" moved the player to the next server of
   * the game; here the next match opens on this server, so the item queues them for it: they stay
   * through the end screen and are carried into the next lobby. The star opens the layout editor.
   */
  @EventHandler(priority = EventPriority.HIGH)
  void onDeadItem(PlayerInteractEvent event) {
    var item = event.getItem();
    var player = event.getPlayer();
    if (item == null || !ghosts.contains(player.getUniqueId())) {
      return;
    }
    if (keys.isNextGame(item)) {
      event.setCancelled(true);
      watchers.queueForNext(player);
    } else if (keys.isKitLayout(item)) {
      event.setCancelled(true);
      kitLayouts.ifPresent(editor -> editor.accept(player));
    }
  }

  private void hideFromTheLiving(Player ghost) {
    for (var viewer : context.server().getOnlinePlayers()) {
      if (!viewer.equals(ghost) && !watching(viewer.getUniqueId())) {
        viewer.hidePlayer(context.plugin(), ghost);
      }
    }
  }

  private boolean watching(UUID player) {
    return ghosts.contains(player) || watchers.watching(player);
  }

  /** {@code id} is out of the match or back in the lobby: no longer a ghost. */
  void release(CombatantId id) {
    var uuid = id.uuid();
    killerView.remove(uuid);
    killers.remove(uuid);
    if (!ghosts.remove(uuid)) {
      return;
    }
    var player = context.server().getPlayer(uuid);
    if (player != null) {
      player.setInvulnerable(false);
      player.setCollidable(true);
      for (var viewer : context.server().getOnlinePlayers()) {
        viewer.showPlayer(context.plugin(), player);
      }
    }
  }

  /** Whether {@code player} is a ghost. */
  boolean ghost(UUID player) {
    return ghosts.contains(player);
  }

  /** Once a second: the killer's view ends, and newcomers do not see the ghosts. */
  void tick() {
    var now = runner.now();
    for (var entry : List.copyOf(killerView.entrySet())) {
      if (!now.isBefore(entry.getValue())) {
        killerView.remove(entry.getKey());
        var player = context.server().getPlayer(entry.getKey());
        if (player != null && ghosts.contains(player.getUniqueId())) {
          player.setSpectatorTarget(null);
          ghost(player, Places.at(player));
        }
      }
    }
    for (var id : ghosts) {
      var ghost = context.server().getPlayer(id);
      if (ghost != null) {
        hideFromTheLiving(ghost);
      }
    }
  }

  /** {@code /rwf spectate next|previous}: follow the next fighter in first person. */
  Optional<String> cycle(Player player, int direction) {
    var id = player.getUniqueId();
    if (!watching(id)) {
      return Optional.of("You are not watching; start with /rwf spectate.");
    }
    var fighters = visibleFighters(player);
    if (fighters.isEmpty()) {
      return Optional.of("Nobody is in the match to follow.");
    }
    var following = player.getSpectatorTarget();
    var index = direction > 0 ? -1 : 0;
    for (var i = 0; following != null && i < fighters.size(); i++) {
      if (fighters.get(i).getUniqueId().equals(following.getUniqueId())) {
        index = i;
      }
    }
    var next = fighters.get(Math.floorMod(index + direction, fighters.size()));
    follow(player, next);
    Texts.info(player, "Following " + next.getName() + ". Sneak to stop.");
    return Optional.empty();
  }

  /** {@code /rwf goto <player>}: jump to a fighter, unless an enemy stealth kit hides them. */
  Optional<String> goTo(Player player, String name) {
    if (!watching(player.getUniqueId())) {
      return Optional.of("You can only do that while watching.");
    }
    var target =
        visibleFighters(player).stream()
            .filter(p -> p.getName().equalsIgnoreCase(name))
            .findFirst();
    if (target.isEmpty()) {
      return Optional.of("Nobody called " + name + " is fighting where you can reach them.");
    }
    runner.move(player, Places.at(target.orElseThrow()));
    return Optional.empty();
  }

  private void follow(Player player, Entity target) {
    killerView.remove(player.getUniqueId());
    player.setGameMode(GameMode.SPECTATOR);
    runner.move(player, Places.at(target));
    player.setSpectatorTarget(target);
  }

  /** The living fighters {@code viewer} may jump to: every one but enemy stealth kits. */
  private List<Player> visibleFighters(Player viewer) {
    var own = runner.memberOf(viewer.getUniqueId()).flatMap(m -> m.team());
    var anyone = viewer.hasPermission(RwfPermissions.SPECTATE_ANYONE);
    var out = new ArrayList<Player>();
    for (var member : runner.match().members()) {
      if (!member.alive()) {
        continue;
      }
      var hidden =
          member.kit().filter(KitBook.HIDDEN_FROM_SPECTATORS::contains).isPresent()
              && !own.equals(member.team())
              && !anyone;
      if (!hidden) {
        runner.entity(member.id()).ifPresent(out::add);
      }
    }
    return out;
  }

  /** The ghost let go of whoever they followed: back to flying over the map with the compass. */
  @EventHandler(priority = EventPriority.MONITOR)
  void onStopFollowing(PlayerStopSpectatingEntityEvent event) {
    var player = event.getPlayer();
    if (ghosts.contains(player.getUniqueId())) {
      killerView.remove(player.getUniqueId());
      context
          .scheduler()
          .runOnMainThread(
              () -> {
                if (ghosts.contains(player.getUniqueId()) && player.isOnline()) {
                  ghost(player, Places.at(player));
                }
              });
    }
  }

  /** The compass: left-click jumps to a random fighter, right-click opens the player menu. */
  @EventHandler(priority = EventPriority.HIGH)
  void onCompass(PlayerInteractEvent event) {
    var player = event.getPlayer();
    var item = event.getItem();
    if (item == null || !keys.isCompass(item) || !ghosts.contains(player.getUniqueId())) {
      return;
    }
    event.setCancelled(true);
    if (event.getAction() == Action.LEFT_CLICK_AIR
        || event.getAction() == Action.LEFT_CLICK_BLOCK) {
      var fighters = visibleFighters(player);
      if (fighters.isEmpty()) {
        Texts.error(player, "Can't find someone to teleport to.");
        return;
      }
      runner.move(player, Places.at(fighters.get(context.random().nextInt(fighters.size()))));
    } else if (event.getAction() == Action.RIGHT_CLICK_AIR
        || event.getAction() == Action.RIGHT_CLICK_BLOCK) {
      new Menu(player).open(player);
    }
  }

  @EventHandler(priority = EventPriority.LOWEST)
  void onMenuClick(InventoryClickEvent event) {
    if (!(event.getView().getTopInventory().getHolder() instanceof Menu menu)) {
      return;
    }
    event.setCancelled(true);
    if (event.getWhoClicked() instanceof Player player) {
      menu.click(player, event.getRawSlot());
    }
  }

  @EventHandler(priority = EventPriority.LOWEST)
  void onMenuDrag(InventoryDragEvent event) {
    if (event.getView().getTopInventory().getHolder() instanceof Menu) {
      event.setCancelled(true);
    }
  }

  /** Who is still fighting, grouped by team: a header per team, then each fighter. */
  final class Menu implements InventoryHolder {

    private static final int SIZE = 54;

    private final Inventory inventory;
    private final Map<Integer, Location> jumps = new HashMap<>();
    private int next;

    Menu(Player viewer) {
      this.inventory =
          context
              .server()
              .createInventory(this, SIZE, Component.text("Spectate", NamedTextColor.DARK_GRAY));
      var snapshot = runner.current();
      if (snapshot.isEmpty()) {
        return;
      }
      var view = snapshot.orElseThrow();
      var visible =
          visibleFighters(viewer).stream()
              .map(Player::getUniqueId)
              .collect(java.util.stream.Collectors.toUnmodifiableSet());
      for (var team : view.teams()) {
        lay(view, team, visible);
      }
    }

    /** Lays out {@code team} from the next row: its header, then each living fighter. */
    private void lay(MatchSnapshot view, TeamColor team, Set<UUID> visible) {
      var fighters =
          view.combatants().stream()
              .filter(c -> c.alive() && c.team().filter(team::equals).isPresent())
              .sorted(Comparator.comparing(MatchSnapshot.CombatantView::name))
              .toList();
      if (fighters.isEmpty()) {
        return;
      }
      next = (next + 8) / 9 * 9;
      if (next >= SIZE) {
        return;
      }
      inventory.setItem(next, header(team));
      var headerSlot = next;
      bombOf(view, team).ifPresent(at -> jumps.put(headerSlot, at));
      next++;
      for (var fighter : fighters) {
        if (next >= SIZE) {
          return;
        }
        place(fighter, visible);
      }
    }

    /** {@code fighter}'s head in the next slot, a jump to them when the viewer may see them. */
    private void place(MatchSnapshot.CombatantView fighter, Set<UUID> visible) {
      var entity = runner.entity(fighter.id());
      inventory.setItem(next, entry(fighter, entity));
      if (visible.contains(fighter.id().uuid()) && entity.isPresent()) {
        jumps.put(next, Places.at(entity.orElseThrow()));
      }
      next++;
    }

    private Optional<Location> bombOf(MatchSnapshot view, TeamColor team) {
      return view.bombs().stream()
          .filter(bomb -> !bomb.nuke() && bomb.team().filter(team::equals).isPresent())
          .findFirst()
          .map(bomb -> Places.center(context.mapWorld(), bomb.position()).add(0, 0.5, 0));
    }

    private ItemStack header(TeamColor team) {
      var stack = new ItemStack(wool(team));
      stack.editMeta(
          meta -> {
            meta.displayName(
                Component.text(team.displayName(), Scoreboards.color(team), TextDecoration.BOLD)
                    .decoration(TextDecoration.ITALIC, false));
            meta.lore(List.of(Component.text("Click to go to their bomb", NamedTextColor.GRAY)));
          });
      return stack;
    }

    private static Material wool(TeamColor team) {
      return switch (team) {
        case RED -> Material.RED_WOOL;
        case BLUE -> Material.BLUE_WOOL;
        case GREEN -> Material.GREEN_WOOL;
        case PURPLE -> Material.PURPLE_WOOL;
        case YELLOW -> Material.YELLOW_WOOL;
      };
    }

    private ItemStack entry(MatchSnapshot.CombatantView fighter, Optional<Player> entity) {
      var stack = new ItemStack(Material.PLAYER_HEAD);
      var team = fighter.team().orElseThrow();
      stack.editMeta(
          meta -> {
            meta.displayName(
                Component.text(fighter.name(), Scoreboards.color(team))
                    .decoration(TextDecoration.ITALIC, false));
            var lore = new ArrayList<Component>();
            lore.add(
                Component.text("Kit: ", NamedTextColor.BLUE)
                    .append(Component.text(fighter.kit().orElse("?"), NamedTextColor.WHITE)));
            // SpectatorInventory shows the floored killstreak as "Kills", assists' shares included.
            lore.add(
                Component.text("Kills: ", NamedTextColor.BLUE)
                    .append(
                        Component.text(
                            String.valueOf(fighter.score().streak()), NamedTextColor.WHITE)));
            entity.ifPresent(
                player ->
                    lore.add(
                        Component.text("Health: ", NamedTextColor.BLUE)
                            .append(
                                Component.text(
                                    String.format(Locale.ROOT, "%.1f", player.getHealth() / 2)
                                        + " ❤",
                                    NamedTextColor.WHITE))));
            lore.add(Component.empty());
            lore.add(
                Component.text("CLICK TO TELEPORT", NamedTextColor.GREEN, TextDecoration.BOLD));
            meta.lore(lore);
          });
      return stack;
    }

    void open(Player viewer) {
      viewer.openInventory(inventory);
    }

    void click(Player player, int slot) {
      var to = jumps.get(slot);
      if (to == null) {
        return;
      }
      context.scheduler().runOnMainThread(player::closeInventory);
      runner.move(player, to);
    }

    @Override
    public Inventory getInventory() {
      return inventory;
    }
  }
}
