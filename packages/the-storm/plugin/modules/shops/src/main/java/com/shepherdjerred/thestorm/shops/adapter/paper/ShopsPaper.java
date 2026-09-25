package com.shepherdjerred.thestorm.shops.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.economy.app.CrystalFormatter;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import com.shepherdjerred.thestorm.shops.app.CatalogTrades;
import com.shepherdjerred.thestorm.shops.app.ChestShops;
import com.shepherdjerred.thestorm.shops.app.RefundJournal;
import com.shepherdjerred.thestorm.shops.app.ServerShops;
import com.shepherdjerred.thestorm.shops.app.ShopLocks;
import com.shepherdjerred.thestorm.shops.app.ShopRegistry;
import com.shepherdjerred.thestorm.shops.app.ShopStore;
import com.shepherdjerred.thestorm.shops.app.ShopTexts;
import com.shepherdjerred.thestorm.shops.app.TradeEngine;
import com.shepherdjerred.thestorm.shops.domain.catalog.Catalog;
import com.shepherdjerred.thestorm.shops.domain.config.ShopsConfig;
import com.shepherdjerred.thestorm.shops.domain.shop.CreationRules;
import com.shepherdjerred.thestorm.shops.domain.sign.ShopSignParser;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.bukkit.Material;

/** Hooks the shops into Paper: listeners, the {@code /shop} command and the NPC shop dialogs. */
public final class ShopsPaper {

  /** Admin shops, opening and breaking anyone's shop, and {@code /shop <catalog>}. */
  public static final String ADMIN_PERMISSION = "thestorm.shops.admin";

  private ShopsPaper() {}

  /**
   * The container materials a config names, each checked against the running game.
   *
   * @throws IllegalStateException if a name is not a block
   */
  public static Set<Material> containers(List<String> names) {
    var problems = new ArrayList<String>();
    var materials = new ArrayList<Material>();
    for (var name : names) {
      var material = Material.getMaterial(name);
      if (material == null || !material.isBlock()) {
        problems.add(name);
      } else {
        materials.add(material);
      }
    }
    if (!problems.isEmpty()) {
      throw new IllegalStateException("shops.yml containers are not blocks: " + problems);
    }
    return Set.copyOf(materials);
  }

  /** Whether an item key names an item, for catalog validation. */
  public static boolean isItem(String key) {
    return ItemTemplates.item(key).isPresent();
  }

  /**
   * Registers everything and returns the NPC shops for other modules.
   *
   * @param state the loaded registry, catalogs and storage
   */
  public static ServerShops install(ModuleContext context, ShopsConfig config, State state) {
    var services = context.services();
    var server = context.plugin().getServer();
    var texts = new ShopTexts(services.require(CrystalFormatter.class));
    var mainThread = context.scheduler().mainThread();
    var replies = new Replies(server, mainThread, context.logger(), texts);
    var locks = new ShopLocks();
    var engine =
        new TradeEngine(
            services.require(Wallets.class),
            mainThread,
            new RefundJournal(state.store(), context.time(), context.logger()));
    var wiring =
        new ChestShops.Wiring(
            state.registry(),
            state.store(),
            locks,
            engine,
            mainThread,
            context.time(),
            context.logger());
    var settings = config.chestShops();
    var notices = new OwnerNoticesListener(server, state.store(), replies, settings.summaryLines());
    var chestShops = new ChestShops(wiring, CreationRules.standard(settings.limits()), notices);
    var blocks =
        new ShopBlocks(context.plugin(), state.registry(), containers(settings.containers()));
    var templates = new ItemTemplates();
    var protection = services.require(Protection.class);
    var plugin = context.plugin();
    var events = server.getPluginManager();
    events.registerEvents(
        new ShopSignListener(
            new ShopSignListener.Deps(
                new ShopSignParser(settings.maxQuantity(), settings.adminShopLabel()),
                settings.adminShopLabel(),
                chestShops,
                state.registry(),
                blocks,
                templates,
                protection,
                context.scheduler(),
                settings.buyClick())),
        plugin);
    events.registerEvents(
        new ShopClickListener(settings, chestShops, new PaperTools(blocks, templates, replies)),
        plugin);
    events.registerEvents(new ShopGuardListener(locks, blocks, chestShops), plugin);
    events.registerEvents(notices, plugin);
    var catalogTrades =
        new CatalogTrades(
            state.catalogs(), wiring, config.catalogs().zone(), config.catalogs().maxLots());
    var serverShops = new DialogServerShops(catalogTrades, replies, context.scheduler());
    var command = new ShopCommand(serverShops, state.registry(), settings.limits());
    context
        .lifecycle()
        .registerEventHandler(
            LifecycleEvents.COMMANDS, event -> command.register(event.registrar()));
    return serverShops;
  }

  /**
   * What the module loaded before hooking into Paper.
   *
   * @param registry every sign shop
   * @param store storage
   * @param catalogs the validated NPC catalogs
   */
  public record State(ShopRegistry registry, ShopStore store, List<Catalog> catalogs) {}
}
