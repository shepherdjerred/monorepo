package com.shepherdjerred.thestorm.shops.adapter.paper;

import static com.mojang.brigadier.arguments.StringArgumentType.getString;
import static com.mojang.brigadier.arguments.StringArgumentType.word;

import com.mojang.brigadier.Command;
import com.mojang.brigadier.tree.LiteralCommandNode;
import com.shepherdjerred.thestorm.shops.app.ServerShops;
import com.shepherdjerred.thestorm.shops.app.ShopRegistry;
import com.shepherdjerred.thestorm.shops.domain.shop.ShopLimits;
import com.shepherdjerred.thestorm.shops.domain.shop.ShopOwner;
import com.shepherdjerred.thestorm.shops.domain.shop.SignShop;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.command.brigadier.Commands;
import java.util.List;
import org.bukkit.FluidCollisionMode;
import org.bukkit.Material;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

/**
 * {@code /shop}: how many chest shops you own and may own; admins also see every closed admin shop.
 * Admins also get {@code /shop <catalog>}, which opens any NPC shop without its NPC, for testing.
 */
final class ShopCommand {

  private static final String CATALOG = "catalog";

  private static final String ITEM = "item";

  /** The shops, notices and limits a command needs. */
  record Wiring(
      ServerShops serverShops,
      ShopRegistry registry,
      ShopLimits limits,
      OwnerNoticesListener notices,
      ShopBlocks blocks,
      String adminShopLabel,
      ShopAccess access) {}

  private final ServerShops serverShops;
  private final ShopRegistry registry;
  private final ShopLimits limits;
  private final OwnerNoticesListener notices;
  private final ShopBlocks blocks;
  private final String adminShopLabel;
  private final ShopAccess access;

  ShopCommand(Wiring wiring) {
    this.serverShops = wiring.serverShops();
    this.registry = wiring.registry();
    this.limits = wiring.limits();
    this.notices = wiring.notices();
    this.blocks = wiring.blocks();
    this.adminShopLabel = wiring.adminShopLabel();
    this.access = wiring.access();
  }

  void register(Commands commands) {
    commands.register(node(), "Shows your chest shops, or opens an NPC shop (admins)");
    commands.register(itemInfoCommand(), "Describes the item you hold, or a named material");
    commands.register(
        Commands.literal("shopinfo")
            .executes(context -> info(context.getSource().getSender()))
            .build(),
        "Describes the shop sign you are looking at",
        List.of());
  }

  private LiteralCommandNode<CommandSourceStack> node() {
    return Commands.literal("shop")
        .executes(context -> status(context.getSource().getSender()))
        .then(
            Commands.literal("toggle").executes(context -> toggle(context.getSource().getSender())))
        .then(Commands.literal("info").executes(context -> info(context.getSource().getSender())))
        .then(
            Commands.literal("access").executes(context -> access(context.getSource().getSender())))
        .then(
            Commands.literal("iteminfo")
                .executes(context -> heldItem(context.getSource().getSender()))
                .then(
                    Commands.argument(ITEM, word())
                        .executes(
                            context ->
                                namedItem(
                                    context.getSource().getSender(), getString(context, ITEM)))))
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
    if (!registry.isReady()) {
      sender.sendMessage(Replies.error("Shops are still loading; try again shortly."));
      return 0;
    }
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

  private LiteralCommandNode<CommandSourceStack> itemInfoCommand() {
    return Commands.literal("iteminfo")
        .executes(context -> heldItem(context.getSource().getSender()))
        .then(
            Commands.argument(ITEM, word())
                .executes(
                    context ->
                        namedItem(context.getSource().getSender(), getString(context, ITEM))))
        .build();
  }

  private int toggle(CommandSender sender) {
    if (!(sender instanceof Player player)) {
      sender.sendMessage(Replies.error("Only players receive shop trade messages."));
      return 0;
    }
    var muted = notices.toggleQuiet(player.getUniqueId());
    player.sendMessage(Replies.info("Shop trade messages are " + (muted ? "off" : "on") + "."));
    return Command.SINGLE_SUCCESS;
  }

  private int access(CommandSender sender) {
    if (!(sender instanceof Player player)) {
      sender.sendMessage(Replies.error("Only players trade at shops."));
      return 0;
    }
    var on = this.access.toggle(player.getUniqueId());
    player.sendMessage(
        Replies.info(
            on
                ? "You can trade at shops whose stock you may open."
                : "You manage your own shops again."));
    return Command.SINGLE_SUCCESS;
  }

  private int info(CommandSender sender) {
    if (!(sender instanceof Player player)) {
      sender.sendMessage(Replies.error("Only players can look at a shop."));
      return 0;
    }
    var block = player.getTargetBlockExact(5, FluidCollisionMode.NEVER);
    if (block == null) {
      player.sendMessage(Replies.error("Look at a shop sign."));
      return 0;
    }
    var shop = blocks.shopAtSign(block);
    if (shop.isEmpty()) {
      player.sendMessage(Replies.error("That is not a shop."));
      return 0;
    }
    player.sendMessage(Replies.info(describe(shop.orElseThrow())));
    return Command.SINGLE_SUCCESS;
  }

  private int heldItem(CommandSender sender) {
    if (!(sender instanceof Player player)) {
      sender.sendMessage(Replies.error("Name an item: /iteminfo coal."));
      return 0;
    }
    var held = player.getInventory().getItemInMainHand();
    if (held.getType().isAir()) {
      player.sendMessage(Replies.error("Hold an item, or name one: /iteminfo coal."));
      return 0;
    }
    return tellItem(player, held.getType());
  }

  private int namedItem(CommandSender sender, String name) {
    var material = ItemTemplates.item(name);
    if (material.isEmpty()) {
      sender.sendMessage(Replies.error("There is no item called \"" + name + "\"."));
      return 0;
    }
    if (sender instanceof Player player) {
      return tellItem(player, material.orElseThrow());
    }
    sender.sendMessage(Replies.info(describeItem(material.orElseThrow())));
    return Command.SINGLE_SUCCESS;
  }

  private int tellItem(Player player, Material material) {
    player.sendMessage(Replies.info(describeItem(material)));
    return Command.SINGLE_SUCCESS;
  }

  private static String describeItem(Material material) {
    return material.name().toLowerCase(java.util.Locale.ROOT)
        + " stacks to "
        + material.getMaxStackSize()
        + (material.isBlock() ? " and can be placed." : ".");
  }

  private String describe(SignShop shop) {
    var owner =
        switch (shop.owner()) {
          case ShopOwner.Player(_, var name) -> name;
          case ShopOwner.Town(_, var name) -> name;
          case ShopOwner.Admin() -> adminShopLabel;
        };
    var item =
        shop.item()
            .map(found -> found.material().toLowerCase(java.util.Locale.ROOT))
            .orElse("unset");
    var buy = shop.prices().buy().map(price -> Long.toString(price.crystals())).orElse("none");
    var sell = shop.prices().sell().map(price -> Long.toString(price.crystals())).orElse("none");
    return owner
        + " sells "
        + shop.quantity()
        + " "
        + item
        + " for "
        + buy
        + " crystals and buys them for "
        + sell
        + ".";
  }

  private int open(CommandSender sender, String catalog) {
    if (!registry.isReady()) {
      sender.sendMessage(Replies.error("Shops are still loading; try again shortly."));
      return 0;
    }
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
