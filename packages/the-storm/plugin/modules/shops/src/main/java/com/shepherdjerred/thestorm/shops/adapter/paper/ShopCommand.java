package com.shepherdjerred.thestorm.shops.adapter.paper;

import static com.mojang.brigadier.arguments.StringArgumentType.getString;
import static com.mojang.brigadier.arguments.StringArgumentType.word;

import com.mojang.brigadier.Command;
import com.mojang.brigadier.tree.LiteralCommandNode;
import com.shepherdjerred.thestorm.shops.app.ServerShops;
import com.shepherdjerred.thestorm.shops.app.ShopRegistry;
import com.shepherdjerred.thestorm.shops.domain.shop.ShopLimits;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.command.brigadier.Commands;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

/**
 * {@code /shop}: how many chest shops you own and may own; admins also see every closed admin shop.
 * Admins also get {@code /shop <catalog>}, which opens any NPC shop without its NPC, for testing.
 */
final class ShopCommand {

  private static final String CATALOG = "catalog";

  private final ServerShops serverShops;
  private final ShopRegistry registry;
  private final ShopLimits limits;

  ShopCommand(ServerShops serverShops, ShopRegistry registry, ShopLimits limits) {
    this.serverShops = serverShops;
    this.registry = registry;
    this.limits = limits;
  }

  void register(Commands commands) {
    commands.register(node(), "Shows your chest shops, or opens an NPC shop (admins)");
  }

  private LiteralCommandNode<CommandSourceStack> node() {
    return Commands.literal("shop")
        .executes(context -> status(context.getSource().getSender()))
        .then(
            Commands.argument(CATALOG, word())
                .requires(source -> source.getSender().hasPermission(ShopsPermissions.OPEN_CATALOG))
                .suggests(
                    (context, builder) -> {
                      serverShops.catalogIds().stream().sorted().forEach(builder::suggest);
                      return builder.buildFuture();
                    })
                .executes(
                    context -> open(context.getSource().getSender(), getString(context, CATALOG))))
        .build();
  }

  private int status(CommandSender sender) {
    if (!(sender instanceof Player player)) {
      sender.sendMessage(Replies.error("Only players own chest shops."));
      return 0;
    }
    var level = ShopsPermissions.shopkeeperLevel(player);
    var owned = registry.ownedBy(player.getUniqueId());
    player.sendMessage(
        Replies.info(
            level == 0
                ? "You own " + owned + " chest shops. Train as a Shopkeeper to open your own."
                : "You own "
                    + owned
                    + " of the "
                    + limits.allowed(level)
                    + " chest shops Shopkeeper "
                    + level
                    + " allows."));
    if (player.hasPermission(ShopsPermissions.OPEN_CATALOG)) {
      registry
          .closed()
          .forEach(
              (id, why) ->
                  registry
                      .byId(id)
                      .ifPresent(
                          shop ->
                              player.sendMessage(
                                  Replies.error(
                                      "Admin shop "
                                          + id
                                          + " at "
                                          + shop.sign().x()
                                          + " "
                                          + shop.sign().y()
                                          + " "
                                          + shop.sign().z()
                                          + " is closed: "
                                          + why))));
    }
    return Command.SINGLE_SUCCESS;
  }

  private int open(CommandSender sender, String catalog) {
    if (!(sender instanceof Player player)) {
      sender.sendMessage(Replies.error("Only players can open a shop."));
      return 0;
    }
    if (!serverShops.has(catalog)) {
      player.sendMessage(
          Replies.error(
              "No shop called "
                  + catalog
                  + ". Shops: "
                  + String.join(", ", serverShops.catalogIds().stream().sorted().toList())
                  + "."));
      return 0;
    }
    serverShops.open(player, catalog);
    return Command.SINGLE_SUCCESS;
  }
}
