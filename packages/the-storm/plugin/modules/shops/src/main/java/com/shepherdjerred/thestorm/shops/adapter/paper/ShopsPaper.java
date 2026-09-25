package com.shepherdjerred.thestorm.shops.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.economy.app.CrystalFormatter;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import com.shepherdjerred.thestorm.shops.app.Background;
import com.shepherdjerred.thestorm.shops.app.CatalogTrades;
import com.shepherdjerred.thestorm.shops.app.ChestShops;
import com.shepherdjerred.thestorm.shops.app.DailyUsage;
import com.shepherdjerred.thestorm.shops.app.MainThreadPump;
import com.shepherdjerred.thestorm.shops.app.RefundJournal;
import com.shepherdjerred.thestorm.shops.app.ServerOffers;
import com.shepherdjerred.thestorm.shops.app.ServerShops;
import com.shepherdjerred.thestorm.shops.app.ShopLocks;
import com.shepherdjerred.thestorm.shops.app.ShopRegistry;
import com.shepherdjerred.thestorm.shops.app.ShopStore;
import com.shepherdjerred.thestorm.shops.app.ShopTexts;
import com.shepherdjerred.thestorm.shops.app.ShutdownDrain;
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
import org.bukkit.plugin.IllegalPluginAccessException;

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
   * What {@link #install} hands back to the module.
   *
   * @param serverShops the NPC shops, published for other modules
   * @param drain settles trades in flight when the module stops
   */
  public record Installed(ServerShops serverShops, ShutdownDrain drain) {}

  /**
   * Registers everything and returns the NPC shops for other modules.
   *
   * @param state the loaded registry, catalogs and storage
   */
  public static Installed install(ModuleContext context, ShopsConfig config, State state) {
    var services = context.services();
    var plugin = context.plugin();
    var server = plugin.getServer();
    var logger = context.logger();
    var texts = new ShopTexts(services.require(CrystalFormatter.class));
    var replies = new Replies(server, context.scheduler().mainThread(), logger, texts);
    // Trades settle through the pump, so the shutdown drain can finish them on the main thread
    // once the scheduler stops taking tasks.
    var mainThread =
        new MainThreadPump(
            task -> {
              if (plugin.isEnabled()) {
                try {
                  context.scheduler().runOnMainThread(task);
                } catch (IllegalPluginAccessException e) {
                  logger.debug("Shop work left queued for the shutdown drain", e);
                }
              }
            });
    var locks = new ShopLocks();
    var journal = new RefundJournal(state.store(), context.time(), logger);
    var engine = new TradeEngine(services.require(Wallets.class), mainThread, journal);
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
    var blocks = new ShopBlocks(plugin, state.registry(), containers(settings.containers()));
    var chestShops =
        new ChestShops(
            wiring,
            CreationRules.standard(settings.limits()),
            new PaperShopEffects(notices, blocks),
            new ServerOffers(state.catalogs(), state.registry()));
    var templates = new ItemTemplates();
    var protection = services.require(Protection.class);
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
    var usage = new DailyUsage(state.store(), context.time(), config.catalogs().zone(), mainThread);
    events.registerEvents(new CatalogUsageListener(usage, logger), plugin);
    server
        .getOnlinePlayers()
        .forEach(
            player ->
                Background.logFailure(
                    usage.preload(player.getUniqueId()), logger, "load catalog usage"));
    var catalogTrades =
        new CatalogTrades(state.catalogs(), wiring, usage, config.catalogs().maxLots());
    var serverShops =
        new DialogServerShops(
            catalogTrades, replies, context.scheduler(), config.catalogs().maxDistance());
    var command = new ShopCommand(serverShops, state.registry(), settings.limits());
    context
        .lifecycle()
        .registerEventHandler(
            LifecycleEvents.COMMANDS, event -> command.register(event.registrar()));
    return new Installed(serverShops, new ShutdownDrain(mainThread, locks, journal));
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
