package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import com.shepherdjerred.thestorm.qol.app.SortBook;
import com.shepherdjerred.thestorm.qol.app.store.SortStore;
import com.shepherdjerred.thestorm.qol.domain.config.QolConfig;
import com.shepherdjerred.thestorm.qol.domain.sort.SortSwitches;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import net.kyori.adventure.text.Component;
import org.bukkit.Material;
import org.bukkit.block.DoubleChest;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.inventory.ClickType;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryCloseEvent;
import org.bukkit.event.inventory.InventoryOpenEvent;
import org.bukkit.event.inventory.InventoryType;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.PlayerInventory;
import org.jspecify.annotations.Nullable;

/**
 * Per-player sorting: the settings screen, automatic sorting, and the hotkeys. A new player starts
 * from the config, which leaves automatic sorting off. Main thread only.
 */
final class SortBehavior implements Listener {

  private static final List<String> LABELS =
      List.of(
          "Automatic chests",
          "Automatic inventory",
          "Middle-click",
          "Shift-click",
          "Double-click",
          "Shift-right-click",
          "Dump outside",
          "Take outside",
          "Left-click a container");

  private static final Duration OUTSIDE_CLICK = Duration.ofMillis(200);

  private final QolRuntime runtime;
  private final SortBook book;
  private final SortStore store;
  private final QolConfig.Sort config;
  private final ContainerSorting sorting;
  private final List<Pattern> blocked;
  private final Map<UUID, Long> lastHotkey = new HashMap<>();
  private final Map<UUID, Cancellable> pendingOutside = new HashMap<>();

  record Wiring(
      QolRuntime runtime,
      SortBook book,
      SortStore store,
      QolConfig.Sort config,
      ContainerSorting sorting) {}

  SortBehavior(Wiring wiring) {
    this.runtime = wiring.runtime();
    this.book = wiring.book();
    this.store = wiring.store();
    this.config = wiring.config();
    this.sorting = wiring.sorting();
    this.blocked = wiring.config().blockedHolders().stream().map(Pattern::compile).toList();
  }

  void openMenu(Player player) {
    if (!ready(player)) {
      return;
    }
    var screen = new SortScreen();
    var inventory = runtime.server().createInventory(screen, 9, Component.text("Sorting"));
    screen.attach(inventory);
    paint(player, inventory);
    player.openInventory(inventory);
  }

  void containers(Player player, String mode) {
    if (!ready(player)) {
      return;
    }
    var current = book.get(player.getUniqueId());
    var on =
        switch (mode) {
          case "on" -> true;
          case "off" -> false;
          case "toggle" -> !current.containers();
          default -> throw new IllegalArgumentException("unknown sort mode " + mode);
        };
    save(player, current.withContainers(on));
    Say.success(player, Say.SORT, on ? "Chests sort automatically." : "Chests stay as they are.");
  }

  void hotkeys(Player player) {
    if (!ready(player)) {
      return;
    }
    var next = book.get(player.getUniqueId()).toggleHotkeys();
    save(player, next);
    Say.success(
        player, Say.SORT, next.middleClick() ? "Click hotkeys are on." : "Click hotkeys are off.");
  }

  void inventory(Player player) {
    if (!ready(player)) {
      return;
    }
    InventorySorter.sortRange(player.getInventory(), 9, 35);
    Say.success(player, Say.SORT, "Inventory sorted.");
  }

  void hotbar(Player player) {
    if (!ready(player)) {
      return;
    }
    InventorySorter.sortRange(player.getInventory(), 0, 8);
    Say.success(player, Say.SORT, "Hotbar sorted.");
  }

  void all(Player player) {
    if (!ready(player)) {
      return;
    }
    InventorySorter.sortRange(player.getInventory(), 0, 35);
    Say.success(player, Say.SORT, "Inventory and hotbar sorted.");
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  void onOpen(InventoryOpenEvent event) {
    if (!(event.getPlayer() instanceof Player player) || !sortsOnOpen()) {
      return;
    }
    autoContainer(player, event.getInventory());
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onClose(InventoryCloseEvent event) {
    if (!(event.getPlayer() instanceof Player player)) {
      return;
    }
    if (event.getInventory().getHolder() instanceof SortScreen) {
      return;
    }
    autoInventory(player);
    if (sortsOnClose()) {
      autoContainer(player, event.getInventory());
    }
  }

  @EventHandler(priority = EventPriority.HIGH)
  void onClick(InventoryClickEvent event) {
    if (!(event.getWhoClicked() instanceof Player player)) {
      return;
    }
    if (event.getView().getTopInventory().getHolder() instanceof SortScreen) {
      menuClick(player, event);
      return;
    }
    if (!book.isLoaded() || !worldAllows(player)) {
      return;
    }
    if (event.getSlot() == -999) {
      outside(player, event);
      return;
    }
    hotkey(player, event);
  }

  private void menuClick(Player player, InventoryClickEvent event) {
    event.setCancelled(true);
    if (event.getRawSlot() >= 0 && event.getRawSlot() < LABELS.size()) {
      toggle(player, event.getRawSlot(), event.getView().getTopInventory());
    }
  }

  private void hotkey(Player player, InventoryClickEvent event) {
    if (!emptySlot(event)) {
      return;
    }
    var clicked = event.getClickedInventory();
    if (clicked == null) {
      return;
    }
    var permission = hotkeyPermission(book.get(player.getUniqueId()), event.getClick());
    if (permission == null || !player.hasPermission(permission) || !cooled(player)) {
      return;
    }
    event.setCancelled(true);
    sortClicked(player, clicked);
  }

  private static @Nullable String hotkeyPermission(SortSwitches switches, ClickType click) {
    return switch (click) {
      case MIDDLE -> switches.middleClick() ? QolPermissions.SORT_MIDDLE : null;
      case SHIFT_LEFT -> switches.shiftClick() ? QolPermissions.SORT_SHIFT : null;
      case DOUBLE_CLICK -> switches.doubleClick() ? QolPermissions.SORT_DOUBLE : null;
      case SHIFT_RIGHT -> switches.shiftRightClick() ? QolPermissions.SORT_SHIFT_RIGHT : null;
      default -> null;
    };
  }

  private void sortClicked(Player player, Inventory clicked) {
    if (clicked instanceof PlayerInventory) {
      InventorySorter.sortRange(player.getInventory(), 9, 35);
    } else if (!blocked(clicked) && sortingAllowed(player, clicked)) {
      InventorySorter.sort(clicked);
    }
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  void onLeftClick(PlayerInteractEvent event) {
    var block = event.getClickedBlock();
    var player = event.getPlayer();
    if (block == null
        || event.getAction() != Action.LEFT_CLICK_BLOCK
        || event.getHand() != org.bukkit.inventory.EquipmentSlot.HAND
        || player.isSneaking()
        || !ContainerSorting.isSortable(block)
        || !book.isLoaded()
        || !book.get(player.getUniqueId()).leftClickBlock()
        || !player.hasPermission(QolPermissions.SORT_LEFT)
        || !cooled(player)) {
      return;
    }
    event.setCancelled(true);
    sorting.sort(player, block);
  }

  private void outside(Player player, InventoryClickEvent event) {
    var top = event.getView().getTopInventory();
    if (blocked(top) || !sortingAllowed(player, top)) {
      return;
    }
    var click =
        new OutsideClick(player, event, top, book.get(player.getUniqueId()), event.getClick());
    if (click.kind() == ClickType.DOUBLE_CLICK) {
      outsideDouble(click);
      return;
    }
    outsideSingle(click);
  }

  private record OutsideClick(
      Player player,
      InventoryClickEvent event,
      Inventory top,
      SortSwitches switches,
      ClickType kind) {}

  private void outsideDouble(OutsideClick click) {
    cancelOutside(click.player());
    if (click.event().isRightClick()
        && click.switches().take()
        && click.player().hasPermission(QolPermissions.SORT_TAKE)) {
      if (!sorting.mayMove(click.player(), click.top(), true)) {
        return;
      }
      click.event().setCancelled(true);
      transfer(
          new Carry(
              click.top(), 0, click.top().getSize() - 1, click.player().getInventory(), true));
      return;
    }
    if (click.switches().dump() && click.player().hasPermission(QolPermissions.SORT_DUMP)) {
      if (!sorting.mayMove(click.player(), click.top(), false)) {
        return;
      }
      click.event().setCancelled(true);
      transfer(new Carry(click.player().getInventory(), 9, 35, click.top(), true));
    }
  }

  private void outsideSingle(OutsideClick click) {
    if (click.kind() != ClickType.LEFT && click.kind() != ClickType.RIGHT) {
      return;
    }
    var dump = click.kind() == ClickType.LEFT;
    if (dump
        && (!click.switches().dump() || !click.player().hasPermission(QolPermissions.SORT_DUMP))) {
      return;
    }
    if (!dump
        && (!click.switches().take() || !click.player().hasPermission(QolPermissions.SORT_TAKE))) {
      return;
    }
    if (!cooled(click.player()) || !sorting.mayMove(click.player(), click.top(), !dump)) {
      return;
    }
    click.event().setCancelled(true);
    cancelOutside(click.player());
    var player = click.player();
    var top = click.top();
    var task =
        runtime
            .scheduler()
            .runOnMainThreadLater(OUTSIDE_CLICK, () -> finishOutside(player, top, dump));
    pendingOutside.put(player.getUniqueId(), task);
  }

  private void finishOutside(Player player, Inventory top, boolean dump) {
    pendingOutside.remove(player.getUniqueId());
    if (!player.isOnline()) {
      return;
    }
    var open = player.getOpenInventory().getTopInventory();
    if (!open.equals(top) || blocked(open) || !sorting.mayMove(player, open, !dump)) {
      return;
    }
    if (dump) {
      transfer(new Carry(player.getInventory(), 0, 35, open, false));
    } else {
      transfer(new Carry(open, 0, open.getSize() - 1, player.getInventory(), false));
    }
  }

  private void toggle(Player player, int slot, Inventory inventory) {
    if (!ready(player)) {
      return;
    }
    save(player, book.get(player.getUniqueId()).toggle(slot));
    paint(player, inventory);
  }

  private void paint(Player player, Inventory inventory) {
    var switches = book.get(player.getUniqueId());
    for (var slot = 0; slot < LABELS.size(); slot++) {
      var on = switches.enabled(slot);
      var item = new ItemStack(on ? Material.LIME_DYE : Material.GRAY_DYE);
      var meta = item.getItemMeta();
      if (meta == null) {
        throw new IllegalStateException("a dye has no item meta");
      }
      meta.displayName(Component.text(LABELS.get(slot) + ": " + (on ? "on" : "off")));
      item.setItemMeta(meta);
      inventory.setItem(slot, item);
    }
  }

  private void autoContainer(Player player, Inventory inventory) {
    if (!book.isLoaded() || !book.get(player.getUniqueId()).containers() || !worldAllows(player)) {
      return;
    }
    if (blocked(inventory) || !sortingAllowed(player, inventory)) {
      return;
    }
    InventorySorter.sort(inventory);
  }

  private void autoInventory(Player player) {
    if (!book.isLoaded() || !book.get(player.getUniqueId()).inventory() || !worldAllows(player)) {
      return;
    }
    InventorySorter.sortRange(player.getInventory(), 9, 35);
  }

  private boolean blocked(Inventory inventory) {
    if (!isContainer(inventory)) {
      return true;
    }
    var holder = inventory.getHolder();
    if (holder instanceof SortScreen) {
      return true;
    }
    if (holder == null) {
      return config.preventNullHolders();
    }
    var name = holder.getClass().getName();
    for (var pattern : blocked) {
      if (pattern.matcher(name).find()) {
        return true;
      }
    }
    if (holder instanceof org.bukkit.block.Container || holder instanceof DoubleChest) {
      return false;
    }
    return inventory.getType() != InventoryType.ENDER_CHEST;
  }

  private static boolean isContainer(Inventory inventory) {
    return switch (inventory.getType()) {
      case CHEST, BARREL, SHULKER_BOX, ENDER_CHEST, DISPENSER, DROPPER, HOPPER -> true;
      default -> false;
    };
  }

  private boolean sortingAllowed(Player player, Inventory inventory) {
    if (inventory.getType() == InventoryType.ENDER_CHEST) {
      return true;
    }
    var location = inventory.getLocation();
    if (location == null) {
      return false;
    }
    return sorting.refusal(player, location.getBlock(), inventory).isEmpty();
  }

  private boolean worldAllows(Player player) {
    return !config.disabledWorlds().contains(player.getWorld().getName());
  }

  private boolean sortsOnOpen() {
    return config.sortTime() == QolConfig.Sort.When.OPEN
        || config.sortTime() == QolConfig.Sort.When.BOTH;
  }

  private boolean sortsOnClose() {
    return config.sortTime() == QolConfig.Sort.When.CLOSE
        || config.sortTime() == QolConfig.Sort.When.BOTH;
  }

  private boolean cooled(Player player) {
    var now = runtime.time().millis();
    var previous = lastHotkey.get(player.getUniqueId());
    if (previous != null && now - previous < config.hotkeyCooldownMillis()) {
      return false;
    }
    lastHotkey.put(player.getUniqueId(), now);
    return true;
  }

  private void cancelOutside(Player player) {
    var pending = pendingOutside.remove(player.getUniqueId());
    if (pending != null) {
      pending.cancel();
    }
  }

  private boolean ready(Player player) {
    if (book.isLoaded()) {
      return true;
    }
    Say.error(player, Say.SORT, "Sorting settings are still loading.");
    return false;
  }

  private void save(Player player, SortSwitches switches) {
    book.put(player.getUniqueId(), switches);
    runtime.onMain(
        store.save(player.getUniqueId(), switches),
        "save sort settings",
        saved -> {},
        failed -> {});
  }

  private static boolean emptySlot(InventoryClickEvent event) {
    return empty(event.getCurrentItem()) && empty(event.getCursor());
  }

  private static boolean empty(@Nullable ItemStack stack) {
    return stack == null || stack.isEmpty();
  }

  /**
   * Moves stacks from {@code from} into {@code to}. When {@code everything} is false, only types
   * already in {@code to} move. Amounts that do not fit stay where they were.
   */
  private record Carry(Inventory from, int start, int end, Inventory to, boolean everything) {}

  private static void transfer(Carry carry) {
    moveSlots(carry, carry.everything() ? Set.<Material>of() : wanted(carry.to()));
  }

  private static Set<Material> wanted(Inventory to) {
    var wanted = new HashSet<Material>();
    var contents = to.getContents();
    if (contents == null) {
      return wanted;
    }
    for (var stack : contents) {
      if (stack != null && !stack.isEmpty()) {
        wanted.add(stack.getType());
      }
    }
    return wanted;
  }

  private static void moveSlots(Carry carry, Set<Material> wanted) {
    for (var slot = carry.start(); slot <= carry.end(); slot++) {
      moveSlot(carry, wanted, slot);
    }
  }

  private static void moveSlot(Carry carry, Set<Material> wanted, int slot) {
    var stack = carry.from().getItem(slot);
    if (stack == null || stack.isEmpty()) {
      return;
    }
    if (!carry.everything() && !wanted.contains(stack.getType())) {
      return;
    }
    var leftovers = new ArrayList<>(carry.to().addItem(stack.clone()).values());
    if (leftovers.isEmpty()) {
      carry.from().setItem(slot, null);
      return;
    }
    carry.from().setItem(slot, leftovers.getFirst());
    for (var extra : leftovers.subList(1, leftovers.size())) {
      carry.from().addItem(extra);
    }
  }

  /** The settings screen. Its holder is how a click knows it is not a chest to sort. */
  static final class SortScreen implements InventoryHolder {

    private @Nullable Inventory inventory;

    void attach(Inventory inventory) {
      this.inventory = inventory;
    }

    @Override
    public Inventory getInventory() {
      var inventory = this.inventory;
      if (inventory == null) {
        throw new IllegalStateException("the sorting screen has no inventory");
      }
      return inventory;
    }
  }
}
