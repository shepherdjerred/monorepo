package com.shepherdjerred.thestorm.shops.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.players.PlayerDirectory;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.core.towns.TownDirectory;
import com.shepherdjerred.thestorm.shops.app.Background;
import com.shepherdjerred.thestorm.shops.app.ShopStore;
import com.shepherdjerred.thestorm.shops.domain.shop.BlockPos;
import com.shepherdjerred.thestorm.shops.domain.shop.ItemFingerprint;
import com.shepherdjerred.thestorm.shops.domain.shop.ShopOwner;
import com.shepherdjerred.thestorm.shops.domain.shop.SignShop;
import com.shepherdjerred.thestorm.shops.domain.sign.ItemLine;
import com.shepherdjerred.thestorm.shops.domain.sign.OwnerLine;
import com.shepherdjerred.thestorm.shops.domain.sign.ShopSignDraft;
import com.shepherdjerred.thestorm.shops.domain.sign.ShopSignParser;
import com.shepherdjerred.thestorm.shops.domain.sign.SignProblem;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.bukkit.Chunk;
import org.bukkit.block.Block;
import org.bukkit.block.Sign;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.world.ChunkLoadEvent;

/** Rebuildable discovery; neither an import catalog nor a shop row is required. */
final class WorldShopDiscovery implements Listener {
  private final ModuleContext context;
  private final ShopBlocks blocks;
  private final ShopStore store;
  private final ShopSignParser parser;
  private final ItemTemplates templates;
  private final Set<BlockPos> pending = new HashSet<>();

  record Parsing(ShopSignParser signs, ItemTemplates items) {}

  WorldShopDiscovery(ModuleContext context, ShopBlocks blocks, ShopStore store, Parsing parsing) {
    this.context = context;
    this.blocks = blocks;
    this.store = store;
    this.parser = parsing.signs();
    this.templates = parsing.items();
    blocks.discovery(this::discover, this::index);
  }

  void scanLoaded() {
    context
        .plugin()
        .getServer()
        .getWorlds()
        .forEach(
            world -> {
              for (var chunk : world.getLoadedChunks()) scan(chunk);
            });
  }

  @EventHandler
  void onLoad(ChunkLoadEvent event) {
    if (blocks.registry().isReady()) scan(event.getChunk());
  }

  private void scan(Chunk chunk) {
    for (var state :
        context
            .services()
            .require(com.shepherdjerred.thestorm.core.world.LoadedBlockEntities.class)
            .inChunk(chunk)) {
      if (state instanceof Sign) blocks.shopAtSign(state.getBlock());
    }
  }

  private void index(SignShop shop) {
    Background.logFailure(store.indexShop(shop), context.logger(), "index world shop " + shop.id());
  }

  private void discover(Block block) {
    if (!(block.getState(false) instanceof Sign sign)) return;
    var lines = ShopBlocks.lines(sign);
    var parsed = parser.parse(lines);
    if (!(parsed instanceof Result.Ok<ShopSignDraft, List<SignProblem>>(var draft))) return;
    // Unlimited server stock always requires an explicit, permission-checked creation.
    if (!(draft.owner() instanceof OwnerLine.Named(var name))) return;
    var container = blocks.connectedContainer(block);
    if (container.isEmpty() || !pending.add(ShopBlocks.pos(block))) return;
    var town =
        context.services().find(TownDirectory.class).flatMap(directory -> directory.named(name));
    if (town.isPresent()) {
      var found = town.orElseThrow();
      install(block, lines, draft, new ShopOwner.Town(found.id(), found.name()));
      return;
    }
    var online = context.plugin().getServer().getPlayerExact(name);
    if (online != null) {
      install(block, lines, draft, new ShopOwner.Player(online.getUniqueId(), online.getName()));
      return;
    }
    var directory = context.services().find(PlayerDirectory.class);
    if (directory.isEmpty()) {
      pending.remove(ShopBlocks.pos(block));
      return;
    }
    var _ =
        directory
            .orElseThrow()
            .byName(name)
            .whenCompleteAsync(
                (found, error) -> {
                  if (!context.plugin().isEnabled()) return;
                  if (error != null) {
                    pending.remove(ShopBlocks.pos(block));
                    context
                        .logger()
                        .error(
                            "Could not resolve world shop owner {} at {}",
                            name,
                            ShopBlocks.pos(block),
                            error);
                  } else if (found.isPresent()) {
                    var player = found.orElseThrow();
                    install(block, lines, draft, new ShopOwner.Player(player.uuid(), name));
                  } else {
                    pending.remove(ShopBlocks.pos(block));
                  }
                },
                context.scheduler().mainThread());
  }

  private void install(
      Block block,
      com.shepherdjerred.thestorm.shops.domain.sign.SignLines expected,
      ShopSignDraft draft,
      ShopOwner owner) {
    pending.remove(ShopBlocks.pos(block));
    // Unstamped signs predate any full account reset. Only fresh, authorized authoring may
    // create a definition in the account's new generation.
    if (!blocks.legacyOwner(owner)) return;
    if (!block.getWorld().isChunkLoaded(block.getX() >> 4, block.getZ() >> 4)) return;
    if (!(block.getState(false) instanceof Sign sign) || !ShopBlocks.lines(sign).equals(expected))
      return;
    var container = blocks.connectedContainer(block);
    if (container.isEmpty()) return;
    Optional<ItemFingerprint> item =
        switch (draft.item()) {
          case ItemLine.Pending() ->
              ShopBlocks.inventoryOf(container.orElseThrow()).stream()
                  .flatMap(inventory -> java.util.Arrays.stream(inventory.getStorageContents()))
                  .filter(stack -> stack != null && !stack.getType().isAir())
                  .findFirst()
                  .map(templates::fingerprint);
          case ItemLine.Named(var name) -> ItemTemplates.item(name).map(templates::plain);
        };
    if (item.isEmpty() && !(draft.item() instanceof ItemLine.Pending)) return;
    var shop =
        new SignShop(
            blocks.registry().reserveId(),
            ShopBlocks.pos(block),
            container.map(ShopBlocks::pos),
            owner,
            draft.quantity(),
            draft.prices(),
            item,
            context.time().instant());
    blocks.rewrite(block, shop, shop.lines("Admin Shop"));
    blocks.registry().add(shop);
    index(shop);
  }
}
