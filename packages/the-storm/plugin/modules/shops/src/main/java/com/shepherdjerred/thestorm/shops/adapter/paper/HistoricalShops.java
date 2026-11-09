package com.shepherdjerred.thestorm.shops.adapter.paper;

import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.core.world.ChunkTickets;
import com.shepherdjerred.thestorm.shops.adapter.content.HistoricalShopCatalog.Entry;
import com.shepherdjerred.thestorm.shops.adapter.db.JooqShopStore;
import com.shepherdjerred.thestorm.shops.app.ShopRegistry;
import com.shepherdjerred.thestorm.shops.domain.price.ShopPrices;
import com.shepherdjerred.thestorm.shops.domain.shop.ShopOwner;
import com.shepherdjerred.thestorm.shops.domain.shop.SignShop;
import java.time.InstantSource;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Server;
import org.bukkit.block.Block;
import org.bukkit.block.Sign;
import org.bukkit.block.sign.Side;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.inventory.InventoryCloseEvent;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.PotionMeta;
import org.bukkit.plugin.Plugin;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;
import org.bukkit.potion.PotionType;
import org.slf4j.Logger;

/** Explicitly converts reviewed legacy signs; an incomplete conversion stays closed to trades. */
final class HistoricalShops implements Listener {
  private static final String IMPORTING = "historical import in progress";
  private final Server server;
  private final Plugin plugin;
  private final ShopRegistry registry;
  private final ShopBlocks blocks;
  private final JooqShopStore store;
  private final Protection protection;
  private final com.shepherdjerred.thestorm.shops.app.ServerOffers offers;
  private final Executor main;
  private final InstantSource time;
  private final Logger logger;
  private final ItemTemplates templates = new ItemTemplates();
  private final HistoricalStock stock;
  private final ChunkLoader chunks;
  private final ChunkTickets tickets;
  private final Map<String, Long> completed;
  private final Set<Entry> awaitingContainer = new LinkedHashSet<>();
  private final Set<com.shepherdjerred.thestorm.shops.domain.shop.BlockPos> changedContainers =
      new LinkedHashSet<>();
  private boolean retrying;

  interface ChunkLoader {
    CompletableFuture<?> load(org.bukkit.World world, int x, int z);
  }

  record Services(
      Plugin plugin,
      ShopRegistry registry,
      ShopBlocks blocks,
      JooqShopStore store,
      Protection protection,
      com.shepherdjerred.thestorm.shops.app.ServerOffers offers) {}

  record ImportRuntime(
      Executor main,
      InstantSource time,
      Logger logger,
      ChunkLoader chunks,
      ChunkTickets tickets,
      Map<String, Long> completed) {}

  HistoricalShops(Services services, ImportRuntime runtime) {
    this.server = services.plugin().getServer();
    this.plugin = services.plugin();
    this.registry = services.registry();
    this.blocks = services.blocks();
    this.store = services.store();
    this.protection = services.protection();
    this.offers = services.offers();
    this.main = runtime.main();
    this.time = runtime.time();
    this.logger = runtime.logger();
    this.stock = new HistoricalStock(plugin);
    this.chunks = runtime.chunks();
    this.tickets = runtime.tickets();
    this.completed = Map.copyOf(runtime.completed());
  }

  CompletableFuture<Void> restore(List<Entry> entries) {
    var result = CompletableFuture.<Void>completedFuture(null);
    for (var entry : entries) {
      result = result.thenComposeAsync(ignored -> loadAndRestore(entry), main);
    }
    return result;
  }

  @EventHandler
  void onClose(InventoryCloseEvent event) {
    var location = event.getInventory().getLocation();
    if (location == null || awaitingContainer.isEmpty()) return;
    containerChanged(ShopBlocks.containerBlocks(location.getBlock()));
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onPlace(BlockPlaceEvent event) {
    if (awaitingContainer.isEmpty()) return;
    containerChanged(List.of(ShopBlocks.pos(event.getBlockPlaced())));
  }

  void containerChanged(List<com.shepherdjerred.thestorm.shops.domain.shop.BlockPos> blocks) {
    main.execute(() -> {
      changedContainers.addAll(blocks);
      retryChangedContainers();
    });
  }

  void retryChangedContainers() {
    if (!plugin.isEnabled() || !registry.isReady() || retrying) return;
    var changed = Set.copyOf(changedContainers);
    changedContainers.clear();
    var entries =
        awaitingContainer.stream()
            .filter(entry -> {
              var world = server.getWorld(entry.world());
              var pos = entry.container();
              return world != null
                  && changed.contains(
                      new com.shepherdjerred.thestorm.shops.domain.shop.BlockPos(
                          world.getUID(), pos.x(), pos.y(), pos.z()));
            })
            .toList();
    if (entries.isEmpty()) return;
    retrying = true;
    var _ =
        restore(entries)
            .whenCompleteAsync(
                (ignored, error) -> {
                  retrying = false;
                  if (error != null) logger.error("Historical shop retry failed", error);
                  retryChangedContainers();
                },
                main);
  }

  private CompletableFuture<Void> loadAndRestore(Entry entry) {
    if (!plugin.isEnabled()) return CompletableFuture.completedFuture(null);
    var world = server.getWorld(entry.world());
    if (world == null) {
      logger.warn("Historical shop {} skipped: world {} is not loaded", entry.id(), entry.world());
      return CompletableFuture.completedFuture(null);
    }
    var sign = entry.sign();
    var chest = entry.container();
    var held = new java.util.ArrayList<HeldChunk>();
    return holdChunk(world, sign.x() >> 4, sign.z() >> 4, held)
        .thenCombine(holdChunk(world, chest.x() >> 4, chest.z() >> 4, held), (a, b) -> true)
        .thenComposeAsync(
            ignored ->
                prepare(
                    entry,
                    world.getBlockAt(sign.x(), sign.y(), sign.z()),
                    world.getBlockAt(chest.x(), chest.y(), chest.z())),
            main)
        .whenCompleteAsync(
            (ignored, error) -> held.forEach(chunk -> tickets.release(world, chunk.x(), chunk.z())),
            main);
  }

  private record HeldChunk(int x, int z) {}

  private CompletableFuture<Void> holdChunk(
      org.bukkit.World world, int x, int z, List<HeldChunk> held) {
    return chunks
        .load(world, x, z)
        .thenRunAsync(
            () -> {
              tickets.hold(world, x, z);
              held.add(new HeldChunk(x, z));
            },
            main);
  }

  private CompletableFuture<Void> prepare(Entry entry, Block sign, Block chest) {
    if (!plugin.isEnabled()) return CompletableFuture.completedFuture(null);
    var existing = registry.atSign(ShopBlocks.pos(sign));
    if (existing.isPresent()) {
      reconcileExisting(entry, sign, chest, existing.orElseThrow());
      return CompletableFuture.completedFuture(null);
    }
    var material = ItemTemplates.item(entry.item());
    var reason = importProblem(entry, sign, chest, material);
    if (reason != null) {
      logger.warn("Historical shop {} skipped: {}", entry.id(), reason);
      return CompletableFuture.completedFuture(null);
    }
    var item = historicalItem(entry, material.orElseThrow(), chest);
    var shop =
        new SignShop(
            registry.reserveId(),
            ShopBlocks.pos(sign),
            Optional.of(ShopBlocks.pos(chest)),
            staffCustody(entry)
                ? new ShopOwner.Admin(true)
                : new ShopOwner.Player(entry.owner(), entry.ownerName()),
            entry.quantity(),
            entry.details().buysFromPlayer()
                ? ShopPrices.sellOnly(entry.price())
                : ShopPrices.buyOnly(entry.price()),
            Optional.of(item),
            java.time.Instant.ofEpochMilli(time.instant().toEpochMilli()));
    var pending = new PendingImport(entry, sign, chest, shop);
    var loop = offers.check(shop);
    if (loop.isPresent()) {
      logger.warn("Historical shop {} skipped: {}", entry.id(), loop.orElseThrow().describe());
      return CompletableFuture.completedFuture(null);
    }
    return store
        .importHistorical(entry.id(), shop)
        .thenComposeAsync(result -> finishImport(pending, result), main);
  }

  private record PendingImport(Entry entry, Block sign, Block chest, SignShop shop) {}

  private void reconcileExisting(Entry entry, Block sign, Block chest, SignShop shop) {
    var receipt = completed.get(entry.id());
    if (receipt != null
        && receipt == shop.id()
        && shop.container().filter(ShopBlocks.pos(chest)::equals).isPresent()
        && (blocks.shopAtSign(sign).isEmpty() || !stock.wasStocked(chest, entry.id()))) {
      registry.retainClosure(shop.id(), "historical shop world data needs staff reconciliation");
      logger.error("Historical shop {} has incomplete saved world data", entry.id());
    }
  }

  private @org.jspecify.annotations.Nullable String importProblem(
      Entry entry, Block sign, Block chest, Optional<org.bukkit.Material> material) {
    if (material.isEmpty()) return "item is unavailable";
    if (!matches(sign, entry)) return "sign text or block changed";
    if (hasShopStamp(sign)) return "sign already has a shop stamp";
    if (!blocks.isShopContainer(chest)) {
      awaitingContainer.add(entry);
      return "container is missing";
    }
    if (entry.details().sourceSlot() >= 0
        && originalItem(entry, material.orElseThrow(), chest).isEmpty())
      return "original item template is missing or changed";
    return accessProblem(entry, sign, chest).orElse(null);
  }

  private static Optional<ItemStack> originalItem(
      Entry entry, org.bukkit.Material material, Block chest) {
    if (!(chest.getState() instanceof org.bukkit.block.Container container))
      return Optional.empty();
    return Optional.ofNullable(
            container.getSnapshotInventory().getItem(entry.details().sourceSlot()))
        .filter(item -> item.getType() == material && !ItemTemplates.holdsItems(item));
  }

  private CompletableFuture<Void> finishImport(
      PendingImport pending, JooqShopStore.HistoricalImport result) {
    if (result != JooqShopStore.HistoricalImport.IMPORTED || !plugin.isEnabled())
      return CompletableFuture.completedFuture(null);
    var entry = pending.entry();
    var shop = pending.shop();
    var sign = pending.sign();
    var chest = pending.chest();
    var problem = importProblem(entry, sign, chest, ItemTemplates.item(entry.item()));
    if (problem != null) {
      registry.retainClosure(shop.id(), "historical import needs reconciliation");
      throw new IllegalStateException(
          "Historical shop changed during import: " + entry.id() + ": " + problem);
    }
    // Protection can inspect connected shops. Publish only after it has checked the old sign.
    registry.add(shop);
    registry.close(shop.id(), IMPORTING);
    var fingerprint = shop.item().orElseThrow();
    var targets =
        fingerprint.bundleDeal()
            ? templates.bundleItems(fingerprint).stream()
                .map(item ->
                    item.asQuantity(Math.multiplyExact(item.getAmount(), entry.stockTarget())))
                .toList()
            : List.of(templates.template(fingerprint).asQuantity(entry.stockTarget()));
    var stocked = stock.stock(chest, entry.id(), targets);
    if (stocked == HistoricalStock.Result.NO_SPACE || stocked == HistoricalStock.Result.BUSY)
      return deferStock(entry, shop, stocked);
    if (stocked != HistoricalStock.Result.STOCKED
        && stocked != HistoricalStock.Result.ALREADY_STOCKED) {
      registry.close(shop.id(), "historical stock needs reconciliation");
      throw new IllegalStateException("Historical stock failed for " + entry.id() + ": " + stocked);
    }
    blocks.rewrite(sign, shop, shop.lines("Admin Shop"));
    return store
        .completeHistorical(entry.id(), shop.id())
        .thenAcceptAsync(
            changed -> {
              if (changed != 1)
                throw new IllegalStateException(
                    "Historical receipt did not complete: " + entry.id());
              awaitingContainer.remove(entry);
              registry.reopen(shop.id(), IMPORTING);
            },
            main);
  }

  private CompletableFuture<Void> deferStock(
      Entry entry, SignShop shop, HistoricalStock.Result result) {
    logger.warn(
        "Historical shop {} stock deferred ({}); close the container after making space to retry",
        entry.id(),
        result);
    return store
        .cancelHistorical(entry.id(), shop.id())
        .thenAcceptAsync(
            cancelled -> {
              if (!cancelled)
                throw new IllegalStateException(
                    "Historical import could not be cancelled: " + entry.id());
              registry.remove(shop.id());
              awaitingContainer.add(entry);
            },
            main);
  }

  private com.shepherdjerred.thestorm.shops.domain.shop.ItemFingerprint historicalItem(
      Entry entry, org.bukkit.Material material, Block chest) {
    if (entry.details().sourceSlot() >= 0) {
      var original =
          originalItem(entry, material, chest)
              .orElseThrow(() ->
                  new IllegalStateException("Validated original shop item changed: " + entry.id()));
      return historicalBundle(entry, original);
    }
    var restored = restoredEnchantment(entry, material);
    if (restored.isPresent()) return restored.orElseThrow();
    var bowEnchantments = bowEnchantments(entry);
    if (!bowEnchantments.isEmpty()) {
      if (material != org.bukkit.Material.BOW)
        throw new IllegalArgumentException("enchanted bow listing must use a bow");
      var bow = ItemStack.of(material);
      bowEnchantments.forEach(bow::addUnsafeEnchantment);
      return templates.fingerprint(bow);
    }
    if (entry.signFormat()
        == com.shepherdjerred.thestorm.shops.adapter.content.HistoricalShopCatalog.SignFormat
            .BOW_WITH_ARROWS) return historicalBundle(entry, ItemStack.of(material));
    return historicalOtherItem(entry, material);
  }

  private com.shepherdjerred.thestorm.shops.domain.shop.ItemFingerprint historicalBundle(
      Entry entry, ItemStack original) {
    if (entry.signFormat()
        != com.shepherdjerred.thestorm.shops.adapter.content.HistoricalShopCatalog.SignFormat
            .BOW_WITH_ARROWS) return templates.fingerprint(original);
    if (original.getType() != org.bukkit.Material.BOW || entry.quantity() != 1)
      throw new IllegalArgumentException("bow-and-arrows listing must sell one complete deal");
    return templates.bundle(List.of(original.asOne(), ItemStack.of(org.bukkit.Material.ARROW, 32)));
  }

  private Optional<com.shepherdjerred.thestorm.shops.domain.shop.ItemFingerprint>
      restoredEnchantment(Entry entry, org.bukkit.Material material) {
    var level =
        switch (entry.signFormat()) {
          case EFFICIENCY_I, SILK_TOUCH -> 1;
          case EFFICIENCY_II -> 2;
          case EFFICIENCY_III -> 3;
          default -> 0;
        };
    if (level == 0) return Optional.empty();
    var enchantment =
        entry.signFormat()
                == com.shepherdjerred.thestorm.shops.adapter.content.HistoricalShopCatalog
                    .SignFormat.SILK_TOUCH
            ? org.bukkit.enchantments.Enchantment.SILK_TOUCH
            : org.bukkit.enchantments.Enchantment.EFFICIENCY;
    var stack = ItemStack.of(material);
    if (stack.getItemMeta() instanceof org.bukkit.inventory.meta.EnchantmentStorageMeta book) {
      book.addStoredEnchant(enchantment, level, false);
      stack.setItemMeta(book);
    } else {
      stack.addUnsafeEnchantment(enchantment, level);
    }
    return Optional.of(templates.fingerprint(stack));
  }

  private static java.util.Map<org.bukkit.enchantments.Enchantment, Integer> bowEnchantments(
      Entry entry) {
    return switch (entry.signFormat()) {
      case BOW_POWER_IV -> java.util.Map.of(org.bukkit.enchantments.Enchantment.POWER, 4);
      case BOW_FLAME_I -> java.util.Map.of(org.bukkit.enchantments.Enchantment.FLAME, 1);
      case BOW_UNBREAKING_FLAME_PUNCH ->
          java.util.Map.of(
              org.bukkit.enchantments.Enchantment.UNBREAKING,
              3,
              org.bukkit.enchantments.Enchantment.FLAME,
              1,
              org.bukkit.enchantments.Enchantment.PUNCH,
              1);
      case BOW_UNBREAKING_POWER_PUNCH ->
          java.util.Map.of(
              org.bukkit.enchantments.Enchantment.UNBREAKING,
              3,
              org.bukkit.enchantments.Enchantment.POWER,
              3,
              org.bukkit.enchantments.Enchantment.PUNCH,
              1);
      case BOW_UNBREAKING_FLAME_POWER ->
          java.util.Map.of(
              org.bukkit.enchantments.Enchantment.UNBREAKING,
              3,
              org.bukkit.enchantments.Enchantment.FLAME,
              1,
              org.bukkit.enchantments.Enchantment.POWER,
              4);
      default -> java.util.Map.<org.bukkit.enchantments.Enchantment, Integer>of();
    };
  }

  private com.shepherdjerred.thestorm.shops.domain.shop.ItemFingerprint historicalOtherItem(
      Entry entry, org.bukkit.Material material) {
    if (entry.signFormat()
        == com.shepherdjerred.thestorm.shops.adapter.content.HistoricalShopCatalog.SignFormat
            .BOW_USED_POWER_III) {
      if (material != org.bukkit.Material.BOW || material.getMaxDurability() <= 73)
        throw new IllegalArgumentException("used bow listing requires a durable bow");
      var bow = ItemStack.of(material);
      bow.addUnsafeEnchantment(org.bukkit.enchantments.Enchantment.POWER, 3);
      bow.editMeta(
          org.bukkit.inventory.meta.Damageable.class,
          meta -> meta.setDamage(material.getMaxDurability() - 73));
      return templates.fingerprint(bow);
    }
    if (entry.signFormat()
        == com.shepherdjerred.thestorm.shops.adapter.content.HistoricalShopCatalog.SignFormat
            .UNBREAKING_PICK) {
      if (material != org.bukkit.Material.DIAMOND_PICKAXE)
        throw new IllegalArgumentException("unbreaking pick listing must use a diamond pickaxe");
      var pick = ItemStack.of(material);
      pick.addUnsafeEnchantment(org.bukkit.enchantments.Enchantment.UNBREAKING, 1);
      return templates.fingerprint(pick);
    }
    var potion = potionType(entry);
    if (potion == null) return templates.plain(material);
    if (material != org.bukkit.Material.POTION && material != org.bukkit.Material.SPLASH_POTION)
      throw new IllegalArgumentException("potion listing must use a potion");
    var stack = ItemStack.of(material);
    var meta = (PotionMeta) stack.getItemMeta();
    meta.setBasePotionType(potion);
    if (entry.signFormat()
            == com.shepherdjerred.thestorm.shops.adapter.content.HistoricalShopCatalog.SignFormat
                .HASTE_POTION
        || entry.signFormat()
            == com.shepherdjerred.thestorm.shops.adapter.content.HistoricalShopCatalog.SignFormat
                .HASTE_POTION_EXT)
      meta.addCustomEffect(
          new PotionEffect(PotionEffectType.HASTE, 9600, 0, true, true, true), true);
    stack.setItemMeta(meta);
    return templates.fingerprint(stack);
  }

  private static @org.jspecify.annotations.Nullable PotionType potionType(Entry entry) {
    return switch (entry.signFormat()) {
      case HASTE_POTION, HASTE_POTION_EXT -> PotionType.MUNDANE;
      case FIRE_RESISTANCE_POTION -> PotionType.LONG_FIRE_RESISTANCE;
      case WATER_BREATHING_POTION -> PotionType.WATER_BREATHING;
      case NIGHT_VISION_POTION -> PotionType.NIGHT_VISION;
      case INVISIBILITY_POTION -> PotionType.INVISIBILITY;
      case LEAPING_POTION -> PotionType.LEAPING;
      case SWIFTNESS_POTION -> PotionType.SWIFTNESS;
      case STRONG_SWIFTNESS_POTION -> PotionType.STRONG_SWIFTNESS;
      case SPLASH_WEAKNESS -> PotionType.WEAKNESS;
      case SPLASH_POISON -> PotionType.POISON;
      case SPLASH_STRONG_POISON -> PotionType.STRONG_POISON;
      case SPLASH_STRONG_HARMING -> PotionType.STRONG_HARMING;
      default -> null;
    };
  }

  private Optional<String> accessProblem(Entry entry, Block sign, Block chest) {
    if (staffCustody(entry)) return custodyProblem(sign, chest);
    var signDecision = protection.check(entry.owner(), ProtectedAction.BUILD, sign.getLocation());
    if (signDecision instanceof Decision.Denied denied)
      return Optional.of(
          "owner cannot build at sign: "
              + PlainTextComponentSerializer.plainText().serialize(denied.reason()));
    for (var pos : ShopBlocks.containerBlocks(chest)) {
      var block = blocks.block(pos).orElseThrow();
      var decision =
          protection.check(entry.owner(), ProtectedAction.OPEN_CONTAINER, block.getLocation());
      if (decision instanceof Decision.Denied denied)
        return Optional.of(
            "owner cannot open container: "
                + PlainTextComponentSerializer.plainText().serialize(denied.reason()));
      if (!registry.ownsAllOn(entry.owner(), pos))
        return Optional.of("container has a shop owned by someone else");
    }
    return Optional.empty();
  }

  private static boolean staffCustody(Entry entry) {
    return entry
        .owner()
        .equals(
            com.shepherdjerred.thestorm.shops.adapter.content.HistoricalShopCatalog.STAFF_CUSTODY);
  }

  private Optional<String> custodyProblem(Block sign, Block chest) {
    if (!protection.mayRestoreHistoricalShop(sign.getLocation()))
      return Optional.of("historical shop restoration is held at sign");
    for (var pos : ShopBlocks.containerBlocks(chest)) {
      var block = blocks.block(pos).orElseThrow();
      if (!protection.mayRestoreHistoricalShop(block.getLocation()))
        return Optional.of("historical shop restoration is held at container");
      if (registry.tradingFrom(pos).stream()
          .anyMatch(shop -> !(shop.owner() instanceof ShopOwner.Admin(var finite) && finite)))
        return Optional.of("container has a shop owned by someone else");
    }
    return Optional.empty();
  }

  private static boolean matches(Block block, Entry entry) {
    if (!(block.getState(false) instanceof Sign sign)) return false;
    var side = sign.getSide(Side.FRONT);
    var serializer = PlainTextComponentSerializer.plainText();
    for (var i = 0; i < 4; i++) {
      if (!serializer.serialize(side.line(i)).equals(entry.expectedLines().get(i))) return false;
    }
    return true;
  }

  private boolean hasShopStamp(Block block) {
    return block.getState(false) instanceof Sign sign
        && sign.getPersistentDataContainer().has(new org.bukkit.NamespacedKey(plugin, "shop_id"));
  }
}
