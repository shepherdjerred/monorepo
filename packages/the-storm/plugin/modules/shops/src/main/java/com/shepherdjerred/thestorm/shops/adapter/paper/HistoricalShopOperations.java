package com.shepherdjerred.thestorm.shops.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.shops.adapter.content.HistoricalShopCatalog;
import com.shepherdjerred.thestorm.shops.adapter.db.JooqShopStore;
import com.shepherdjerred.thestorm.shops.app.ShopRegistry;
import com.shepherdjerred.thestorm.shops.domain.catalog.Catalog;
import com.shepherdjerred.thestorm.shops.domain.config.ShopsConfig;
import io.papermc.paper.command.brigadier.Commands;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import org.bukkit.command.CommandSender;

/** Explicit one-time conversion and stocking; normal startup only discovers native world shops. */
public final class HistoricalShopOperations {
  public record State(ShopRegistry registry, JooqShopStore store, List<Catalog> catalogs) {}

  private record Prepared(List<HistoricalShopCatalog.Entry> entries, Map<String, Long> completed) {}

  private final ModuleContext context;
  private final ShopsConfig config;
  private final State state;
  private boolean running;

  private HistoricalShopOperations(ModuleContext context, ShopsConfig config, State state) {
    this.context = context;
    this.config = config;
    this.state = state;
  }

  public static void install(ModuleContext context, ShopsConfig config, State state) {
    var operations = new HistoricalShopOperations(context, config, state);
    context
        .lifecycle()
        .registerEventHandler(
            LifecycleEvents.COMMANDS,
            event ->
                event
                    .registrar()
                    .register(
                        Commands.literal("shoprestore")
                            .requires(source -> mayRestore(source.getSender()))
                            .executes(command ->
                                operations.prepare(command.getSource().getSender(), false))
                            .then(
                                Commands.literal("apply")
                                    .executes(command ->
                                        operations.prepare(command.getSource().getSender(), true)))
                            .build(),
                        "Previews or applies the reviewed legacy shop conversion"));
  }

  static boolean mayRestore(CommandSender sender) {
    if (sender instanceof org.bukkit.command.ProxiedCommandSender proxied)
      return mayRestore(proxied.getCaller());
    return sender instanceof org.bukkit.command.ConsoleCommandSender
        || sender instanceof org.bukkit.command.RemoteConsoleCommandSender
        || (!(sender instanceof org.bukkit.entity.Entity)
            && !(sender instanceof org.bukkit.command.BlockCommandSender)
            && sender.hasPermission(ShopsPermissions.RESTORE))
        || sender.hasPermission(ShopsPermissions.ADMIN);
  }

  private int prepare(CommandSender sender, boolean apply) {
    if (running || !state.registry().isReady()) {
      sender.sendMessage(Replies.error("Shop restoration is running, or shops are still loading."));
      return 0;
    }
    running = true;
    sender.sendMessage(
        Replies.info("Preparing reviewed legacy shop " + (apply ? "conversion" : "preview") + "."));
    var entries = context.compute().submit(HistoricalShopCatalog::load);
    var completed = state.store().completedHistoricalShops();
    var _ =
        entries
            .thenCombine(completed, Prepared::new)
            .thenComposeAsync(
                prepared -> run(sender, prepared, apply), context.scheduler().mainThread())
            .whenCompleteAsync(
                (ignored, error) -> {
                  running = false;
                  if (error != null) {
                    context.logger().error("Legacy shop operation failed", error);
                    sender.sendMessage(
                        Replies.error(
                            "Shop restoration failed; inspect the server log before retrying."));
                  } else if (!apply) {
                    context.logger().info("Completed reviewed legacy shop preview");
                  }
                },
                context.scheduler().mainThread());
    return 1;
  }

  private CompletableFuture<Void> run(CommandSender sender, Prepared prepared, boolean apply) {
    if (!context.plugin().isEnabled())
      return CompletableFuture.failedFuture(new IllegalStateException("plugin stopped"));
    var remaining =
        prepared.entries().stream()
            .filter(entry -> !prepared.completed().containsKey(entry.id()))
            .count();
    var summary =
        "Reviewed legacy shops: "
            + prepared.entries().size()
            + "; remaining conversion receipts: "
            + remaining
            + ". Existing stock is preserved; additions use the catalog's validated budgets.";
    context.logger().info(summary);
    sender.sendMessage(Replies.info(summary));
    if (!apply) {
      sender.sendMessage(
          Replies.info(
              "/shoprestore apply converts matching legacy signs to ChestShop and stocks them once. Skips and missing containers are reported in the server log."));
      return CompletableFuture.completedFuture(null);
    }
    var restoration =
        ShopsPaper.restoreHistorical(
            context,
            config,
            new ShopsPaper.HistoricalState(
                state.registry(),
                state.store(),
                prepared.entries(),
                prepared.completed(),
                state.catalogs()));
    return restoration
        .completion()
        .thenRun(() -> context.logger().info("Completed reviewed legacy shop conversion"))
        .thenRunAsync(
            () ->
                sender.sendMessage(
                    Replies.info(
                        "Reviewed shop conversion finished. Inspect skipped-shop and reconciliation messages in the server log.")),
            context.scheduler().mainThread());
  }
}
