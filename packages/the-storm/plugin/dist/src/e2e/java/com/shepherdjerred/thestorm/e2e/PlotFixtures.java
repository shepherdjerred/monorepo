package com.shepherdjerred.thestorm.e2e;

import com.mojang.brigadier.arguments.StringArgumentType;
import com.shepherdjerred.thestorm.TheStormPlugin;
import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.towns.adapter.db.JooqLeaseStore;
import com.shepherdjerred.thestorm.towns.app.ParcelBook;
import com.shepherdjerred.thestorm.towns.domain.parcel.LeasePayment;
import io.papermc.paper.command.brigadier.Commands;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.bukkit.plugin.java.JavaPlugin;

/** Test-only clock checkpoint: seed an expired lease without changing production time or gates. */
final class PlotFixtures {
  private final JavaPlugin plugin;

  PlotFixtures(JavaPlugin plugin) {
    this.plugin = plugin;
  }

  void register() {
    plugin
        .getLifecycleManager()
        .registerEventHandler(
            LifecycleEvents.COMMANDS,
            event ->
                event
                    .registrar()
                    .register(
                        Commands.literal("plotfixture")
                            .requires(
                                source ->
                                    source.getSender()
                                            instanceof org.bukkit.command.ConsoleCommandSender
                                        || source.getSender()
                                            instanceof
                                            org.bukkit.command.RemoteConsoleCommandSender)
                            .then(
                                Commands.literal("active")
                                    .then(
                                        Commands.argument("owner", StringArgumentType.word())
                                            .executes(
                                                context -> {
                                                  seed(
                                                      StringArgumentType.getString(
                                                          context, "owner"),
                                                      false,
                                                      true);
                                                  return 1;
                                                })))
                            .then(
                                Commands.literal("materials")
                                    .then(
                                        Commands.argument("owner", StringArgumentType.word())
                                            .executes(
                                                context -> {
                                                  seed(
                                                      StringArgumentType.getString(
                                                          context, "owner"),
                                                      false,
                                                      false);
                                                  return 1;
                                                })))
                            .then(
                                Commands.literal("check")
                                    .then(
                                        Commands.argument("owner", StringArgumentType.word())
                                            .executes(
                                                context -> {
                                                  check(
                                                      StringArgumentType.getString(
                                                          context, "owner"));
                                                  context
                                                      .getSource()
                                                      .getSender()
                                                      .sendMessage("PLOT_FIXTURE CHECKED");
                                                  return 1;
                                                })))
                            .then(
                                Commands.argument("owner", StringArgumentType.word())
                                    .executes(
                                        context -> {
                                          seed(
                                              StringArgumentType.getString(context, "owner"),
                                              true,
                                              false);
                                          context
                                              .getSource()
                                              .getSender()
                                              .sendMessage("PLOT_FIXTURE RUNNING");
                                          return 1;
                                        }))
                            .build()));
  }

  private void seed(String name, boolean withShop, boolean active) {
    var player = java.util.Objects.requireNonNull(plugin.getServer().getPlayerExact(name));
    var storm =
        (TheStormPlugin)
            java.util.Objects.requireNonNull(
                plugin.getServer().getPluginManager().getPlugin("TheStorm"));
    var book = storm.service(ParcelBook.class);
    if (!book.prepared("market-01")
        || book.lease("market-01")
            .filter(lease -> !lease.owner().equals(player.getUniqueId()))
            .isPresent()) {
      throw new IllegalStateException(
          "prepare a market baseline without another owner's lease first");
    }
    var payment =
        new LeasePayment(
            UUID.randomUUID(),
            "market-01",
            player.getUniqueId(),
            active ? Instant.parse("2100-01-01T00:00:00Z") : Instant.EPOCH,
            720);
    var database = StormDatabase.open(storm.getDataPath().resolve("the-storm.db"));
    var store = new JooqLeaseStore(database);
    var _ =
        store
            .prepare(payment)
            .thenCompose(ignored -> store.applied(payment))
            .whenComplete(
                (written, failure) -> {
                  plugin
                      .getServer()
                      .getScheduler()
                      .runTask(
                          plugin,
                          () -> {
                            if (failure == null) {
                              book.committed(payment.lease());
                              var _ =
                                  (withShop
                                          ? stockShop(storm, player)
                                          : CompletableFuture.<Void>completedFuture(null))
                                      .thenRun(
                                          () ->
                                              plugin
                                                  .getServer()
                                                  .broadcast(
                                                      net.kyori.adventure.text.Component.text(
                                                          "PLOT_FIXTURE READY")));
                            } else {
                              plugin
                                  .getLogger()
                                  .log(
                                      java.util.logging.Level.SEVERE,
                                      "Plot fixture failed",
                                      failure);
                            }
                          });
                  var _ = CompletableFuture.runAsync(database::close);
                });
  }

  private CompletableFuture<Void> stockShop(TheStormPlugin storm, org.bukkit.entity.Player player) {
    var world = java.util.Objects.requireNonNull(plugin.getServer().getWorld("world"));
    world
        .getBlockAt(65, 69, -182)
        .setBlockData(
            org.bukkit.Bukkit.createBlockData("minecraft:oak_wall_sign[facing=south]"), false);
    var template =
        java.util.Base64.getEncoder()
            .encodeToString(
                new org.bukkit.inventory.ItemStack(org.bukkit.Material.DIAMOND).serializeAsBytes());
    var shop =
        new com.shepherdjerred.thestorm.shops.domain.shop.SignShop(
            900001,
            new com.shepherdjerred.thestorm.shops.domain.shop.BlockPos(
                world.getUID(), 65, 69, -182),
            java.util.Optional.of(
                new com.shepherdjerred.thestorm.shops.domain.shop.BlockPos(
                    world.getUID(), 65, 69, -183)),
            new com.shepherdjerred.thestorm.shops.domain.shop.ShopOwner.Player(
                player.getUniqueId(), player.getName()),
            2,
            com.shepherdjerred.thestorm.shops.domain.price.ShopPrices.both(11, 7),
            java.util.Optional.of(
                new com.shepherdjerred.thestorm.shops.domain.shop.ItemFingerprint(
                    "diamond", template, false)),
            Instant.EPOCH);
    return storm
        .service(com.shepherdjerred.thestorm.shops.app.ShopRelocation.class)
        .restore(
            com.shepherdjerred.thestorm.shops.app.ShopArchive.encode(java.util.List.of(shop)),
            new com.shepherdjerred.thestorm.shops.app.ShopRelocation.Target(
                world.getUID(), 0, 0, 0));
  }

  private void check(String name) {
    var player = java.util.Objects.requireNonNull(plugin.getServer().getPlayerExact(name));
    var storm =
        (TheStormPlugin)
            java.util.Objects.requireNonNull(
                plugin.getServer().getPluginManager().getPlugin("TheStorm"));
    var world = java.util.Objects.requireNonNull(plugin.getServer().getWorld("world"));
    var port = storm.service(com.shepherdjerred.thestorm.shops.app.ShopRelocation.class);
    var shops =
        com.shepherdjerred.thestorm.shops.app.ShopArchive.decode(
            port.snapshot(
                new com.shepherdjerred.thestorm.shops.app.ShopRelocation.Area(
                    world.getUID(), 300, 120, 300, 311, 147, 311),
                player.getUniqueId()));
    if (shops.size() != 1
        || shops.getFirst().id() != 900001
        || shops.getFirst().quantity() != 2
        || !shops
            .getFirst()
            .prices()
            .equals(com.shepherdjerred.thestorm.shops.domain.price.ShopPrices.both(11, 7))) {
      throw new IllegalStateException("recovered shop identity or terms did not verify");
    }
    var protection = storm.service(com.shepherdjerred.thestorm.core.protection.Protection.class);
    var chest = new org.bukkit.Location(world, 301, 120, 301);
    var open = com.shepherdjerred.thestorm.core.protection.ProtectedAction.OPEN_CONTAINER;
    if (!protection.check(player.getUniqueId(), open, chest).isAllowed()
        || protection.check(new UUID(0, 1), open, chest).isAllowed()) {
      throw new IllegalStateException("recovered container lock did not retain owner-only access");
    }
  }
}
