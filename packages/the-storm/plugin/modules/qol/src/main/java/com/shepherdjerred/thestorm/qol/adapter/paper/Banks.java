package com.shepherdjerred.thestorm.qol.adapter.paper;

import static java.util.Objects.requireNonNull;
import static java.util.UUID.randomUUID;

import com.shepherdjerred.thestorm.core.module.Services;
import com.shepherdjerred.thestorm.core.players.PlayerDirectory;
import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.core.protection.ReservedContainers;
import com.shepherdjerred.thestorm.core.text.HouseStyle;
import com.shepherdjerred.thestorm.qol.app.BankBook;
import com.shepherdjerred.thestorm.qol.app.store.BankStore;
import com.shepherdjerred.thestorm.qol.domain.bank.BankAccess;
import com.shepherdjerred.thestorm.qol.domain.bank.BankRole;
import com.shepherdjerred.thestorm.qol.domain.bank.LimitSet;
import com.shepherdjerred.thestorm.qol.domain.bank.Shelving;
import com.shepherdjerred.thestorm.qol.domain.bank.Shelving.Move;
import com.shepherdjerred.thestorm.qol.domain.bank.Shelving.Pile;
import com.shepherdjerred.thestorm.qol.domain.bank.Shelving.ShelfOpening;
import com.shepherdjerred.thestorm.qol.domain.bank.StoredBank;
import com.shepherdjerred.thestorm.qol.domain.bank.StoredBank.Spot;
import com.shepherdjerred.thestorm.qol.domain.bank.StoredBank.StoredShelf;
import com.shepherdjerred.thestorm.qol.domain.config.QolConfig;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Consumer;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.block.BlockState;
import org.bukkit.block.DoubleChest;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockDispenseEvent;
import org.bukkit.event.block.BlockRedstoneEvent;
import org.bukkit.event.block.SignChangeEvent;
import org.bukkit.event.inventory.InventoryCloseEvent;
import org.bukkit.event.inventory.InventoryMoveItemEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import org.bukkit.inventory.ItemStack;
import org.jspecify.annotations.Nullable;

/**
 * Deposit banks. A {@code [Bank]} sign (or {@code /bank add}) marks a container; {@code [Shelf]}
 * signs name what they accept. Closing the bank, a hopper delivery, or redstone moves matching
 * items onto the first shelf with room. Main thread only.
 */
final class Banks implements Listener {

  static final String LABEL = "Bank";

  private static final int REACH = 5;
  private static final Duration NEXT_TICK = Duration.ofMillis(50);

  private final QolRuntime runtime;
  private final BankBook book;
  private final BankStore store;
  private final QolConfig.Bank config;
  private final Protection protection;
  private final Services services;
  private final Places places = new Places();

  record Gear(
      QolRuntime runtime,
      BankBook book,
      BankStore store,
      QolConfig.Bank config,
      Protection protection,
      Services services) {}

  Banks(Gear gear) {
    this.runtime = gear.runtime();
    this.book = gear.book();
    this.store = gear.store();
    this.config = gear.config();
    this.protection = gear.protection();
    this.services = gear.services();
  }

  BankBook book() {
    return book;
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  void onSign(SignChangeEvent event) {
    var header = plain(event.line(0));
    var kind = kind(header);
    if (kind.isEmpty()) {
      return;
    }
    var player = event.getPlayer();
    if (!ready(player)) {
      event.setCancelled(true);
      return;
    }
    var sign = event.getBlock();
    var ok =
        switch (kind.orElseThrow()) {
          case BANK -> createBank(player, sign);
          case SHELF, RELOAD -> {
            var text = readText(event);
            if (text.isEmpty()) {
              Say.error(player, LABEL, "A shelf line must name an item, or say restack.");
              yield false;
            }
            yield switch (kind.orElseThrow()) {
              case BANK -> false;
              case SHELF -> placeShelf(player, sign, text.orElseThrow());
              case RELOAD -> reload(player, sign, text.orElseThrow());
            };
          }
        };
    if (!ok) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  void onShiftAdd(PlayerInteractEvent event) {
    var block = event.getClickedBlock();
    if (block == null
        || event.getHand() != EquipmentSlot.HAND
        || event.getAction() != org.bukkit.event.block.Action.RIGHT_CLICK_BLOCK
        || !event.getPlayer().isSneaking()) {
      return;
    }
    var item = event.getItem();
    if (item == null || item.getType().isAir()) {
      return;
    }
    var spot = BankBlocks.spot(block);
    var bank = book.bankOfShelf(spot).orElse(null);
    if (bank == null) {
      return;
    }
    var shelf = bank.shelfAt(spot).orElse(null);
    if (shelf == null) {
      return;
    }
    event.setCancelled(true);
    var player = event.getPlayer();
    if (!ready(player) || !can(player, bank, BankRole.ADD)) {
      Say.error(player, LABEL, "You cannot add items to that shelf.");
      return;
    }
    var key = item.getType().getKey().toString();
    if (shelf.materials().contains(key)) {
      Say.info(player, LABEL, item.getType().getKey().getKey() + " is already on that shelf.");
      return;
    }
    var materials = new LinkedHashSet<>(shelf.materials());
    materials.add(key);
    remember(
        bank.withShelfReplaced(
            new StoredShelf(
                shelf.id(), shelf.sign(), shelf.container(), shelf.restack(), materials)));
    Say.success(player, LABEL, "That shelf now accepts " + item.getType().getKey().getKey() + ".");
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onClose(InventoryCloseEvent event) {
    if (!(event.getPlayer() instanceof Player player)) {
      return;
    }
    var bank = bankInventory(event.getInventory()).orElse(null);
    if (bank == null || !book.isLoaded()) {
      return;
    }
    shelve(player.getUniqueId(), book.get(bank.id()).orElse(bank), player);
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onHopper(InventoryMoveItemEvent event) {
    var bank = bankInventory(event.getDestination()).orElse(null);
    if (bank == null) {
      return;
    }
    var id = bank.id();
    runtime
        .scheduler()
        .runOnMainThreadLater(NEXT_TICK, () -> book.get(id).ifPresent(this::shelveAutomatic));
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onRedstone(BlockRedstoneEvent event) {
    if (event.getOldCurrent() != 0 || event.getNewCurrent() <= 0) {
      return;
    }
    var bank = bankContainer(event.getBlock()).orElse(null);
    if (bank == null) {
      return;
    }
    var id = bank.id();
    runtime
        .scheduler()
        .runOnMainThreadLater(NEXT_TICK, () -> book.get(id).ifPresent(this::shelveAutomatic));
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  void onDispense(BlockDispenseEvent event) {
    var bank = bankContainer(event.getBlock()).orElse(null);
    if (bank == null) {
      return;
    }
    event.setCancelled(true);
    shelveAutomatic(bank);
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  void onBreak(BlockBreakEvent event) {
    var block = event.getBlock();
    var spot = BankBlocks.spot(block);
    var bank =
        book.atSign(spot)
            .or(() -> bankContainer(block))
            .or(() -> book.bankOfShelf(spot))
            .orElse(null);
    if (bank == null) {
      return;
    }
    var player = event.getPlayer();
    var listed =
        player.getUniqueId().equals(bank.owner())
            || bank.grants().containsKey(player.getUniqueId())
            || admin(player);
    var landAllows =
        protection
            .check(player.getUniqueId(), ProtectedAction.BREAK, block.getLocation())
            .isAllowed();
    if (!listed && !landAllows) {
      event.setCancelled(true);
      Say.error(player, LABEL, "You cannot break that bank.");
      return;
    }
    var shelf = bank.shelfAt(spot).orElse(null);
    var ownSign = bank.sign().isAt(spot.world(), spot.x(), spot.y(), spot.z());
    var ownContainer = isBankBlock(bank, block);
    if (shelf != null && !ownSign && !ownContainer) {
      remember(bank.withoutShelf(shelf.id()));
      Say.info(player, LABEL, "Shelf removed.");
      return;
    }
    forget(bank);
    Say.info(player, LABEL, "Bank removed.");
  }

  /** {@code /bank add}: links the container being looked at, with no sign. */
  void add(Player player) {
    if (!ready(player) || !permitted(player, QolPermissions.BANK_ADD)) {
      return;
    }
    var block = lookedAt(player);
    if (block == null || !BankBlocks.isContainer(block)) {
      Say.error(player, LABEL, "Look at a chest, barrel, copper chest or dispenser within reach.");
      return;
    }
    var spot = BankBlocks.spot(block);
    linkShelf(
        new ShelfLink(
            player, spot, spot, new ShelfText(Set.of(), false), "Shelf linked to your bank."));
  }

  void find(Player player, String item) {
    if (!ready(player) || !permitted(player, QolPermissions.BANK_FIND)) {
      return;
    }
    var material = Material.matchMaterial(item);
    if (material == null || material.isAir()) {
      Say.error(player, LABEL, "Unknown item: " + item);
      return;
    }
    var origin = requireNonNull(player.getLocation(), "an online player has a location");
    var search =
        new Search(
            player,
            material,
            player.getWorld().getName(),
            origin.getBlockX(),
            origin.getBlockY(),
            origin.getBlockZ(),
            limits(player).findRadius());
    var lines = new ArrayList<String>();
    for (var bank : book.all()) {
      found(search, bank).ifPresent(lines::add);
    }
    if (lines.isEmpty()) {
      Say.info(player, LABEL, "None of that within " + search.radius() + " blocks.");
      return;
    }
    Say.info(player, LABEL, "Found " + material.getKey().getKey() + ":");
    lines.forEach(line -> Say.info(player, LABEL, line));
  }

  private Optional<String> found(Search search, StoredBank bank) {
    var container = bank.container();
    if (!container.world().equals(search.world())) {
      return Optional.empty();
    }
    var dx = container.x() - search.x();
    var dy = container.y() - search.y();
    var dz = container.z() - search.z();
    if (!LimitSet.inRange(dx, dy, dz, search.radius())
        || !can(search.player(), bank, BankRole.OPEN)
        || !chunkLoaded(container)) {
      return Optional.empty();
    }
    var count = count(bank, search.material());
    if (count <= 0) {
      return Optional.empty();
    }
    return Optional.of(
        count
            + " "
            + search.material().getKey().getKey()
            + " at "
            + container.x()
            + " "
            + container.y()
            + " "
            + container.z());
  }

  void describe(Player player) {
    if (!ready(player)) {
      return;
    }
    var bank = lookedAtBank(player);
    if (bank == null) {
      Say.info(player, LABEL, "Look at a bank, or use /bank add, find, list, access or quit.");
      return;
    }
    Say.info(
        player,
        LABEL,
        "Bank at "
            + bank.container().x()
            + " "
            + bank.container().y()
            + " "
            + bank.container().z()
            + " with "
            + bank.shelves().size()
            + " shelves.");
  }

  void list(Player player) {
    if (!ready(player)) {
      return;
    }
    var bank = lookedAtBank(player);
    if (bank == null || !can(player, bank, BankRole.OPEN)) {
      Say.error(player, LABEL, "Look at a bank you can open.");
      return;
    }
    if (bank.grants().isEmpty()) {
      Say.info(
          player, LABEL, "Nobody else is listed. Everyone else is " + config.fallbackRole() + ".");
      return;
    }
    Say.info(player, LABEL, "Access list:");
    bank.grants().forEach((id, role) -> Say.info(player, LABEL, name(id) + ": " + role));
  }

  void grant(Player player, String name, @Nullable String roleName) {
    if (!ready(player)) {
      return;
    }
    var bank = lookedAtBank(player);
    if (bank == null || !can(player, bank, BankRole.MANAGE)) {
      Say.error(player, LABEL, "Look at a bank you manage.");
      return;
    }
    var role = BankRole.OPEN;
    if (roleName != null) {
      try {
        role = BankRole.valueOf(roleName.toUpperCase(Locale.ROOT));
      } catch (IllegalArgumentException e) {
        Say.error(player, LABEL, "Role is open, add, remove or manage.");
        return;
      }
    }
    var chosen = role;
    var target = bank;
    resolve(
        name,
        id -> {
          if (id.equals(target.owner())) {
            Say.error(player, LABEL, "The owner is always allowed.");
            return;
          }
          var current = book.get(target.id()).orElse(target);
          remember(current.withGrant(id, chosen));
          Say.success(player, LABEL, name + " may " + chosen + ".");
        },
        () -> Say.error(player, LABEL, "No player named " + name + "."));
  }

  void revoke(Player player, String name) {
    if (!ready(player)) {
      return;
    }
    var bank = lookedAtBank(player);
    if (bank == null || !can(player, bank, BankRole.MANAGE)) {
      Say.error(player, LABEL, "Look at a bank you manage.");
      return;
    }
    var target = bank;
    resolve(
        name,
        id -> {
          var current = book.get(target.id()).orElse(target);
          if (!current.grants().containsKey(id)) {
            Say.error(player, LABEL, name + " is not on this bank.");
            return;
          }
          remember(current.withoutGrant(id));
          Say.success(player, LABEL, name + " was removed.");
        },
        () -> Say.error(player, LABEL, "No player named " + name + "."));
  }

  void quit(Player player) {
    if (!ready(player)) {
      return;
    }
    var bank = lookedAtBank(player);
    if (bank == null) {
      Say.error(player, LABEL, "Look at a bank.");
      return;
    }
    if (player.getUniqueId().equals(bank.owner())) {
      Say.error(player, LABEL, "You own this bank.");
      return;
    }
    if (!bank.grants().containsKey(player.getUniqueId())) {
      Say.error(player, LABEL, "You are not on this bank.");
      return;
    }
    remember(bank.withoutGrant(player.getUniqueId()));
    Say.success(player, LABEL, "You left the bank.");
  }

  /** Drops banks and shelves whose blocks are gone. Returns how many records were dropped. */
  int sweep() {
    if (!book.isLoaded()) {
      return 0;
    }
    var dropped = 0;
    for (var bank : List.copyOf(book.all())) {
      if (missing(bank.container(), false) || missing(bank.sign(), true)) {
        forget(bank);
        dropped++;
        continue;
      }
      for (var shelf : List.copyOf(bank.shelves())) {
        if (missing(shelf.container(), false) || missing(shelf.sign(), true)) {
          var current = book.get(bank.id()).orElse(bank);
          remember(current.withoutShelf(shelf.id()));
          dropped++;
        }
      }
    }
    return dropped;
  }

  void check(Player player) {
    if (!permitted(player, QolPermissions.BANK_CHECK)) {
      return;
    }
    Say.info(player, LABEL, "Dropped " + sweep() + " missing banks and shelves.");
  }

  void reload(Player player) {
    if (!permitted(player, QolPermissions.BANK_RELOAD)) {
      return;
    }
    runtime.onMain(
        store.loadAll(),
        "reload banks",
        loaded -> {
          book.load(loaded);
          Say.success(player, LABEL, "Loaded " + loaded.size() + " banks.");
        },
        failed -> Say.error(player, LABEL, "Banks could not be reloaded."));
  }

  private boolean createBank(Player player, Block sign) {
    if (!permitted(player, QolPermissions.BANK_CREATE)) {
      return false;
    }
    var container = BankBlocks.claimed(sign, config).orElse(null);
    if (container == null) {
      Say.error(player, LABEL, "That sign needs a chest, barrel, copper chest or dispenser.");
      return false;
    }
    if (!usable(player, container)) {
      return false;
    }
    var limits = limits(player);
    if (book.ownedBy(player.getUniqueId()) >= limits.banksPerPlayer()) {
      Say.error(player, LABEL, "You already have " + limits.banksPerPlayer() + " banks.");
      return false;
    }
    var containerSpot = BankBlocks.spot(container);
    remember(
        new StoredBank(
            randomUUID().toString(),
            player.getUniqueId(),
            BankBlocks.spot(sign),
            containerSpot,
            Map.of(),
            List.of()));
    Say.success(player, LABEL, "Bank created.");
    return true;
  }

  private boolean placeShelf(Player player, Block sign, ShelfText text) {
    if (!permitted(player, QolPermissions.BANK_ADD)) {
      return false;
    }
    var container = BankBlocks.claimed(sign, config).orElse(null);
    if (container == null) {
      Say.error(player, LABEL, "That sign needs a chest, barrel, copper chest or dispenser.");
      return false;
    }
    return linkShelf(
        new ShelfLink(
            player, BankBlocks.spot(sign), BankBlocks.spot(container), text, "Shelf linked."));
  }

  private boolean linkShelf(ShelfLink link) {
    var player = link.player();
    var sign = link.sign();
    var container = link.container();
    var text = link.text();
    var done = link.done();
    var block = block(container).orElse(null);
    if (block == null || !BankBlocks.isContainer(block)) {
      Say.error(player, LABEL, "That is not a container.");
      return false;
    }
    if (!usable(player, block)) {
      return false;
    }
    var bank = nearest(player, container, BankRole.ADD).orElse(null);
    if (bank == null) {
      Say.error(player, LABEL, "No bank you can add to is within range.");
      return false;
    }
    if (bank.container().equals(container)) {
      Say.error(player, LABEL, "That container is already the bank.");
      return false;
    }
    if (bank.shelves().size() >= limits(player).shelvesPerBank()) {
      Say.error(player, LABEL, "That bank already has its shelves.");
      return false;
    }
    var id = String.format(Locale.ROOT, "%08d-%s", bank.shelves().size(), randomUUID());
    remember(
        bank.withShelf(new StoredShelf(id, sign, container, text.restack(), text.materials())));
    Say.success(player, LABEL, done);
    return true;
  }

  private boolean reload(Player player, Block sign, ShelfText text) {
    var container = BankBlocks.claimed(sign, config).orElse(sign);
    var spot = BankBlocks.spot(container);
    var bank =
        book.bankOfShelf(spot).or(() -> book.bankOfShelf(BankBlocks.spot(sign))).orElse(null);
    if (bank == null) {
      Say.error(player, LABEL, "That is not a shelf.");
      return false;
    }
    var shelf = bank.shelfAt(spot).or(() -> bank.shelfAt(BankBlocks.spot(sign))).orElse(null);
    if (shelf == null || !can(player, bank, BankRole.ADD)) {
      Say.error(player, LABEL, "You cannot change that shelf.");
      return false;
    }
    remember(
        bank.withShelfReplaced(
            new StoredShelf(
                shelf.id(), shelf.sign(), shelf.container(), text.restack(), text.materials())));
    Say.success(player, LABEL, "Shelf updated.");
    return true;
  }

  private void shelveAutomatic(StoredBank bank) {
    places.shelveAutomatic(bank);
  }

  private void shelve(UUID actor, StoredBank bank, @Nullable Player tell) {
    places.shelve(actor, bank, tell);
  }

  private boolean usable(Player player, Block container) {
    return places.usable(player, container);
  }

  private Optional<StoredBank> nearest(Player player, Spot container, BankRole needed) {
    return places.nearest(player, container, needed);
  }

  private Optional<StoredBank> bankInventory(Inventory inventory) {
    return places.bankInventory(inventory);
  }

  private Optional<StoredBank> bankContainer(Block block) {
    return places.bankContainer(block);
  }

  private boolean isBankBlock(StoredBank bank, Block block) {
    return places.isBankBlock(bank, block);
  }

  private int count(StoredBank bank, Material material) {
    return places.count(bank, material);
  }

  private boolean missing(Spot spot, boolean sign) {
    return places.missing(spot, sign);
  }

  private boolean chunkLoaded(Spot spot) {
    return places.chunkLoaded(spot);
  }

  private Optional<Block> block(Spot spot) {
    return places.block(spot);
  }

  private final class Places {

    private void shelveAutomatic(StoredBank bank) {
      shelve(bank.owner(), bank, null);
    }

    private void shelve(UUID actor, StoredBank bank, @Nullable Player tell) {
      if (!actorMayShelve(tell, bank)) {
        return;
      }
      var container = block(bank.container()).orElse(null);
      if (container == null || blocked(actor, container, tell)) {
        return;
      }
      var batch = new ShelfBatch(new ArrayList<>(), new HashMap<>());
      if (!gather(actor, bank, tell, batch)) {
        return;
      }
      var inventory = BankBlocks.inventory(container).orElse(null);
      if (inventory == null) {
        return;
      }
      apply(inventory, batch.inventories(), Shelving.plan(piles(inventory), batch.openings()));
    }

    private boolean actorMayShelve(@Nullable Player tell, StoredBank bank) {
      return tell == null
          || (permitted(tell, QolPermissions.BANK_USE) && can(tell, bank, BankRole.OPEN));
    }

    private boolean blocked(UUID actor, Block container, @Nullable Player tell) {
      var denied = refusal(actor, container).orElse(null);
      if (denied == null) {
        return false;
      }
      if (tell != null) {
        tell.sendMessage(HouseStyle.error(LABEL, denied));
      }
      return true;
    }

    private record Taken(@Nullable Inventory inventory, boolean stop) {}

    private record ShelfBatch(List<ShelfOpening> openings, Map<String, Inventory> inventories) {}

    private boolean gather(UUID actor, StoredBank bank, @Nullable Player tell, ShelfBatch batch) {
      for (var shelf : bank.shelves()) {
        var taken = take(actor, shelf, tell);
        if (taken.stop()) {
          return false;
        }
        var inventory = taken.inventory();
        if (inventory == null) {
          continue;
        }
        if (shelf.restack()) {
          compact(inventory, shelf.materials());
        }
        batch.openings().add(opening(shelf, inventory));
        batch.inventories().put(shelf.id(), inventory);
      }
      return true;
    }

    private Taken take(UUID actor, StoredShelf shelf, @Nullable Player tell) {
      if (!chunkLoaded(shelf.container())) {
        return new Taken(null, false);
      }
      var shelfBlock = block(shelf.container()).orElse(null);
      if (shelfBlock == null || !BankBlocks.isContainer(shelfBlock)) {
        return new Taken(null, false);
      }
      var denied = refusal(actor, shelfBlock).orElse(null);
      if (denied != null) {
        if (tell != null) {
          tell.sendMessage(HouseStyle.error(LABEL, denied));
        }
        return new Taken(null, true);
      }
      return new Taken(BankBlocks.inventory(shelfBlock).orElse(null), false);
    }

    private boolean usable(Player player, Block container) {
      if (reserved(container) || occupied(container)) {
        Say.error(player, LABEL, "That container is already a shop, a bank or a shelf.");
        return false;
      }
      var denied = refusal(player.getUniqueId(), container).orElse(null);
      if (denied != null) {
        player.sendMessage(HouseStyle.error(LABEL, denied));
        return false;
      }
      return true;
    }

    private boolean reserved(Block container) {
      var reservations = services.find(ReservedContainers.class);
      if (reservations.isEmpty()) {
        return false;
      }
      for (var half : BankBlocks.halves(container)) {
        if (reservations.orElseThrow().contains(half.getLocation())) {
          return true;
        }
      }
      return false;
    }

    private boolean occupied(Block container) {
      for (var half : BankBlocks.halves(container)) {
        var spot = BankBlocks.spot(half);
        if (book.atSign(spot).isPresent()
            || book.atContainer(spot).isPresent()
            || book.shelfAtSign(spot).isPresent()) {
          return true;
        }
      }
      return false;
    }

    private Optional<Component> refusal(UUID actor, Block container) {
      for (var half : BankBlocks.halves(container)) {
        var decision = protection.check(actor, ProtectedAction.OPEN_CONTAINER, half.getLocation());
        if (decision instanceof Decision.Denied denied) {
          return Optional.of(denied.reason());
        }
      }
      return Optional.empty();
    }

    private Optional<StoredBank> nearest(Player player, Spot container, BankRole needed) {
      StoredBank best = null;
      var bestDistance = Long.MAX_VALUE;
      var radius = limits(player).linkRadius();
      for (var bank : book.all()) {
        var at = bank.container();
        if (!at.world().equals(container.world()) || !can(player, bank, needed)) {
          continue;
        }
        var dx = (long) at.x() - container.x();
        var dy = (long) at.y() - container.y();
        var dz = (long) at.z() - container.z();
        if (!LimitSet.inRange(dx, dy, dz, radius)) {
          continue;
        }
        var distance = dx * dx + dy * dy + dz * dz;
        if (distance < bestDistance) {
          best = bank;
          bestDistance = distance;
        }
      }
      return Optional.ofNullable(best);
    }

    private Optional<StoredBank> bankInventory(Inventory inventory) {
      var holder = inventory.getHolder();
      if (holder instanceof DoubleChest chest) {
        var left = side(chest.getLeftSide());
        if (left != null) {
          var bank = bankContainer(left).orElse(null);
          if (bank != null) {
            return Optional.of(bank);
          }
        }
        var right = side(chest.getRightSide());
        return right == null ? Optional.empty() : bankContainer(right);
      }
      if (holder instanceof BlockState state) {
        return bankContainer(state.getBlock());
      }
      return Optional.empty();
    }

    private Optional<StoredBank> bankContainer(Block block) {
      for (var half : BankBlocks.halves(block)) {
        var spot = BankBlocks.spot(half);
        for (var bank : book.all()) {
          if (bank.container().isAt(spot.world(), spot.x(), spot.y(), spot.z())) {
            return Optional.of(bank);
          }
        }
      }
      return Optional.empty();
    }

    private boolean isBankBlock(StoredBank bank, Block block) {
      for (var half : BankBlocks.halves(block)) {
        var spot = BankBlocks.spot(half);
        if (bank.container().isAt(spot.world(), spot.x(), spot.y(), spot.z())) {
          return true;
        }
      }
      return false;
    }

    private int count(StoredBank bank, Material material) {
      var total = 0;
      var container = block(bank.container()).orElse(null);
      if (container != null) {
        total += count(BankBlocks.inventory(container).orElse(null), material);
      }
      for (var shelf : bank.shelves()) {
        var shelfBlock = block(shelf.container()).orElse(null);
        if (shelfBlock != null) {
          total += count(BankBlocks.inventory(shelfBlock).orElse(null), material);
        }
      }
      return total;
    }

    private static int count(@Nullable Inventory inventory, Material material) {
      if (inventory == null) {
        return 0;
      }
      var contents = inventory.getContents();
      if (contents == null) {
        return 0;
      }
      var total = 0;
      for (var stack : contents) {
        if (stack != null && stack.getType() == material) {
          total += stack.getAmount();
        }
      }
      return total;
    }

    private boolean missing(Spot spot, boolean sign) {
      if (!chunkLoaded(spot)) {
        return false;
      }
      var block = block(spot).orElse(null);
      if (block == null) {
        return false;
      }
      if (sign && signless(spot)) {
        return false;
      }
      return sign ? !BankBlocks.isSign(block) : !BankBlocks.isContainer(block);
    }

    /** A signless bank or shelf stores the container in the sign spot. */
    private boolean signless(Spot spot) {
      for (var bank : book.all()) {
        if (bank.sign().equals(spot) && bank.container().equals(spot)) {
          return true;
        }
        for (var shelf : bank.shelves()) {
          if (shelf.sign().equals(spot) && shelf.container().equals(spot)) {
            return true;
          }
        }
      }
      return false;
    }

    private boolean chunkLoaded(Spot spot) {
      var world = runtime.server().getWorld(spot.world());
      return world != null
          && world.isChunkLoaded(Math.floorDiv(spot.x(), 16), Math.floorDiv(spot.z(), 16));
    }

    private Optional<Block> block(Spot spot) {
      if (!chunkLoaded(spot)) {
        return Optional.empty();
      }
      var world = runtime.server().getWorld(spot.world());
      if (world == null) {
        return Optional.empty();
      }
      return Optional.of(world.getBlockAt(spot.x(), spot.y(), spot.z()));
    }

    private static List<Pile> piles(Inventory inventory) {
      var piles = new ArrayList<Pile>();
      for (var index = 0; index < inventory.getSize(); index++) {
        var stack = inventory.getItem(index);
        if (stack == null || stack.getType().isAir() || stack.getAmount() < 1) {
          continue;
        }
        piles.add(
            new Pile(
                stack.getType().getKey().toString(),
                stack.getAmount(),
                stack.getMaxStackSize(),
                index));
      }
      return piles;
    }

    private static ShelfOpening opening(StoredShelf shelf, Inventory inventory) {
      var contents = inventory.getContents();
      if (contents == null) {
        return new ShelfOpening(shelf.id(), shelf.materials(), inventory.getSize(), Map.of());
      }
      var empty = 0;
      var partial = new HashMap<String, Integer>();
      for (var stack : contents) {
        if (stack == null || stack.getType().isAir()) {
          empty++;
          continue;
        }
        var key = stack.getType().getKey().toString();
        if (!shelf.materials().contains(key)) {
          continue;
        }
        var room = stack.getMaxStackSize() - stack.getAmount();
        if (room > 0) {
          partial.merge(key, room, Integer::sum);
        }
      }
      return new ShelfOpening(shelf.id(), shelf.materials(), empty, partial);
    }

    private static void compact(Inventory inventory, Set<String> materials) {
      var indexes = new ArrayList<Integer>();
      var groups = new ArrayList<List<ItemStack>>();
      for (var index = 0; index < inventory.getSize(); index++) {
        var stack = inventory.getItem(index);
        if (stack == null || stack.getType().isAir()) {
          continue;
        }
        if (!materials.contains(stack.getType().getKey().toString())) {
          continue;
        }
        indexes.add(index);
        inventory.setItem(index, null);
        groupWithSimilar(groups, stack.clone());
      }
      var cursor = 0;
      for (var group : groups) {
        cursor = rewrite(inventory, indexes, cursor, group);
      }
    }

    private static void groupWithSimilar(List<List<ItemStack>> groups, ItemStack stack) {
      for (var group : groups) {
        if (group.getFirst().isSimilar(stack)) {
          group.add(stack);
          return;
        }
      }
      var group = new ArrayList<ItemStack>();
      group.add(stack);
      groups.add(group);
    }

    private static int rewrite(
        Inventory inventory, List<Integer> indexes, int cursor, List<ItemStack> group) {
      var template = group.getFirst();
      var left = 0;
      for (var stack : group) {
        left += stack.getAmount();
      }
      var max = template.getMaxStackSize();
      while (left > 0) {
        var copy = template.clone();
        var amount = Math.min(left, max);
        copy.setAmount(amount);
        inventory.setItem(indexes.get(cursor), copy);
        cursor++;
        left -= amount;
      }
      return cursor;
    }

    private static void apply(
        Inventory source, Map<String, Inventory> destinations, List<Move> moves) {
      var byPile = new HashMap<Integer, List<Move>>();
      for (var move : moves) {
        byPile.computeIfAbsent(move.pileIndex(), ignored -> new ArrayList<>()).add(move);
      }
      for (var entry : byPile.entrySet()) {
        movePile(source, destinations, entry.getKey(), entry.getValue());
      }
    }

    private static void movePile(
        Inventory source, Map<String, Inventory> destinations, int slot, List<Move> moves) {
      var stack = source.getItem(slot);
      if (stack == null || stack.getType().isAir()) {
        return;
      }
      var total = moves.stream().mapToInt(Move::amount).sum();
      if (total > stack.getAmount() || total < 1) {
        return;
      }
      var template = stack.clone();
      var left = stack.getAmount() - total;
      if (left == 0) {
        source.setItem(slot, null);
      } else {
        stack.setAmount(left);
      }
      var delivery = new Delivery(source, destinations, slot, template);
      for (var move : moves) {
        deliver(delivery, move);
      }
    }

    private record Delivery(
        Inventory source, Map<String, Inventory> destinations, int slot, ItemStack template) {}

    private static void deliver(Delivery delivery, Move move) {
      var moving = delivery.template().clone();
      moving.setAmount(move.amount());
      var destination = delivery.destinations().get(move.shelfId());
      if (destination == null) {
        giveBack(delivery.source(), delivery.slot(), moving);
        return;
      }
      for (var leftover : destination.addItem(moving).values()) {
        giveBack(delivery.source(), delivery.slot(), leftover);
      }
    }

    private static void giveBack(Inventory source, int slot, ItemStack item) {
      for (var leftover : source.addItem(item).values()) {
        var current = source.getItem(slot);
        if (current == null || current.getType().isAir()) {
          source.setItem(slot, leftover);
        } else if (current.isSimilar(leftover)
            && current.getAmount() + leftover.getAmount() <= current.getMaxStackSize()) {
          current.setAmount(current.getAmount() + leftover.getAmount());
        } else {
          throw new IllegalStateException("shelving could not return " + leftover);
        }
      }
    }
  }

  private @Nullable StoredBank lookedAtBank(Player player) {
    var block = lookedAt(player);
    if (block == null) {
      return null;
    }
    var spot = BankBlocks.spot(block);
    return book.atSign(spot)
        .or(() -> bankContainer(block))
        .or(() -> book.bankOfShelf(spot))
        .orElse(null);
  }

  private @Nullable Block lookedAt(Player player) {
    return player.getTargetBlockExact(REACH);
  }

  private LimitSet limits(Player player) {
    var granted = new ArrayList<LimitSet>();
    for (var group : config.groups().entrySet()) {
      if (player.hasPermission(QolPermissions.BANK_LIMITS + group.getKey())) {
        granted.add(group.getValue());
      }
    }
    var wide = LimitSet.widest(config.limits(), granted);
    if (player.hasPermission(QolPermissions.BANK_UNLIMITED)) {
      return new LimitSet(
          Integer.MAX_VALUE, Integer.MAX_VALUE, wide.linkRadius(), wide.findRadius());
    }
    return wide;
  }

  private boolean can(Player player, StoredBank bank, BankRole needed) {
    return BankAccess.allowed(
        new BankAccess.Query(
            player.getUniqueId(),
            bank.owner(),
            bank.grants(),
            needed,
            config.fallbackRole(),
            admin(player)));
  }

  private boolean admin(Player player) {
    return player.hasPermission(QolPermissions.BANK_ADMIN);
  }

  private boolean permitted(Player player, String permission) {
    if (player.hasPermission(permission) || admin(player)) {
      return true;
    }
    Say.error(player, LABEL, "You cannot do that.");
    return false;
  }

  private boolean ready(Player player) {
    if (book.isLoaded()) {
      return true;
    }
    Say.error(player, LABEL, "Banks are still loading.");
    return false;
  }

  private void remember(StoredBank bank) {
    book.put(bank);
    runtime.onMain(store.save(bank), "save bank", saved -> {}, failed -> {});
  }

  private void forget(StoredBank bank) {
    book.remove(bank.id());
    runtime.onMain(store.delete(bank.id()), "delete bank", saved -> {}, failed -> {});
  }

  private void resolve(String name, Consumer<UUID> found, Runnable missing) {
    for (var online : runtime.server().getOnlinePlayers()) {
      if (online.getName().equalsIgnoreCase(name)) {
        found.accept(online.getUniqueId());
        return;
      }
    }
    var directory = services.find(PlayerDirectory.class);
    if (directory.isEmpty()) {
      missing.run();
      return;
    }
    runtime.onMain(
        directory.orElseThrow().byName(name),
        "bank player",
        player -> {
          if (player.isEmpty()) {
            missing.run();
          } else {
            found.accept(player.orElseThrow().uuid());
          }
        },
        failed -> missing.run());
  }

  private String name(UUID id) {
    for (var online : runtime.server().getOnlinePlayers()) {
      if (online.getUniqueId().equals(id)) {
        return online.getName();
      }
    }
    return id.toString();
  }

  private static Optional<ShelfText> readText(SignChangeEvent event) {
    var materials = new LinkedHashSet<String>();
    var restack = false;
    for (var index = 1; index < event.lines().size(); index++) {
      var text = plain(event.line(index));
      if (text.isEmpty()) {
        continue;
      }
      if (text.equalsIgnoreCase("restack")) {
        restack = true;
        continue;
      }
      var material = Material.matchMaterial(text);
      if (material == null || material.isAir() || !material.isItem()) {
        return Optional.empty();
      }
      materials.add(material.getKey().toString());
    }
    return Optional.of(new ShelfText(materials, restack));
  }

  private static Optional<Kind> kind(String header) {
    if (header.equalsIgnoreCase("[Bank]")) {
      return Optional.of(Kind.BANK);
    }
    if (header.equalsIgnoreCase("[Shelf]")) {
      return Optional.of(Kind.SHELF);
    }
    if (header.equalsIgnoreCase("[MondoReload]")) {
      return Optional.of(Kind.RELOAD);
    }
    return Optional.empty();
  }

  private static String plain(@Nullable Component component) {
    if (component == null) {
      return "";
    }
    return PlainTextComponentSerializer.plainText().serialize(component).trim();
  }

  private static @Nullable Block side(@Nullable InventoryHolder holder) {
    if (holder instanceof BlockState state) {
      return state.getBlock();
    }
    return null;
  }

  private enum Kind {
    BANK,
    SHELF,
    RELOAD
  }

  private record ShelfText(Set<String> materials, boolean restack) {

    ShelfText {
      materials = Set.copyOf(materials);
    }
  }

  private record ShelfLink(Player player, Spot sign, Spot container, ShelfText text, String done) {}

  private record Search(
      Player player, Material material, String world, int x, int y, int z, int radius) {}
}
