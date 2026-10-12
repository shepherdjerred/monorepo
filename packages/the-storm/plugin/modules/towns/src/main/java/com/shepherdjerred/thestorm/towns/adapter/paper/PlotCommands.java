package com.shepherdjerred.thestorm.towns.adapter.paper;

import static com.mojang.brigadier.arguments.StringArgumentType.getString;
import static com.mojang.brigadier.arguments.StringArgumentType.word;

import com.mojang.brigadier.Command;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.towns.app.PlotRentals;
import io.papermc.paper.command.brigadier.Commands;
import java.util.LinkedHashMap;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.Supplier;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

/** Player choices and explicit staff preparation; RCON polls finite reconciliation operations. */
final class PlotCommands {
  private final PlotParts parts;
  private final PlotRentals rentals;
  private final PackedShops packed;
  private final PlotResetting resetting;
  private final LinkedHashMap<UUID, String> operations = new LinkedHashMap<>();

  PlotCommands(PlotParts parts, PlotRentals rentals, PackedShops packed, PlotResetting resetting) {
    this.parts = parts;
    this.rentals = rentals;
    this.packed = packed;
    this.resetting = resetting;
  }

  void register(Commands commands) {
    var root =
        Commands.literal("plot")
            .executes(c -> list(c.getSource().getSender()))
            .then(Commands.literal("list").executes(c -> list(c.getSource().getSender())));
    for (var name : java.util.List.of("rent", "renew")) {
      root.then(
          Commands.literal(name)
              .requires(source -> source.getSender() instanceof Player)
              .then(
                  Commands.argument("id", word())
                      .executes(
                          c ->
                              pay(
                                  (Player) c.getSource().getSender(),
                                  getString(c, "id"),
                                  name.equals("renew")))));
    }
    root.then(
        Commands.literal("confirm")
            .requires(source -> source.getSender() instanceof Player)
            .executes(
                c ->
                    start(
                        c.getSource().getSender(),
                        () -> packed.confirm((Player) c.getSource().getSender()),
                        "Your shop has been unpacked.")));
    root.then(
        Commands.literal("cancel")
            .requires(source -> source.getSender() instanceof Player)
            .executes(
                c -> {
                  packed.cancel(((Player) c.getSource().getSender()).getUniqueId());
                  c.getSource().getSender().sendMessage(Notices.info("Preview cancelled."));
                  return Command.SINGLE_SUCCESS;
                }));
    root.then(
        Commands.literal("reissue")
            .requires(source -> source.getSender() instanceof Player)
            .then(
                Commands.argument("id", word())
                    .executes(
                        c ->
                            start(
                                c.getSource().getSender(),
                                () ->
                                    packed.reissue(
                                        ((Player) c.getSource().getSender()).getUniqueId(),
                                        UUID.fromString(getString(c, "id"))),
                                "Replacement sent to /mail. Previous copies are now invalid."))));
    root.then(
        Commands.literal("admin")
            .requires(source -> source.getSender().hasPermission(RegionCommands.ADMIN_PERMISSION))
            .then(
                Commands.literal("rollback")
                    .then(
                        Commands.argument("id", word())
                            .executes(
                                c ->
                                    start(
                                        c.getSource().getSender(),
                                        () -> packed.rollback(UUID.fromString(getString(c, "id"))),
                                        "Placement rolled back. The packed shop can be used again."))))
            .then(
                Commands.literal("baseline")
                    .then(
                        Commands.argument("id", word())
                            .executes(
                                c ->
                                    start(
                                        c.getSource().getSender(),
                                        () -> resetting.baseline(getString(c, "id")),
                                        "Recovery baseline saved."))))
            .then(
                Commands.literal("reconcile")
                    .then(
                        Commands.argument("operation", word())
                            .executes(
                                c ->
                                    reconcile(
                                        c.getSource().getSender(), getString(c, "operation")))))
            .then(
                Commands.literal("status")
                    .then(
                        Commands.argument("operation", word())
                            .executes(
                                c ->
                                    status(
                                        c.getSource().getSender(), getString(c, "operation"))))));
    commands.register(root.build(), "Protected holdings, weekly shops and recovered builds");
  }

  private int list(CommandSender sender) {
    for (var def : parts.parcels().definitions()) {
      var lease = parts.parcels().lease(def.id());
      var owners =
          lease
              .map(value -> value.owner().toString())
              .orElseGet(() -> def.owners().isEmpty() ? "staff custody" : def.owners().toString());
      sender.sendMessage(
          Notices.info(def.id() + " — " + def.name() + " (" + def.kind() + "): " + owners));
      sender.sendMessage(Notices.info("Bounds: " + def.area()));
      sender.sendMessage(Notices.info(def.provenance()));
      if (def.weeklyRent() > 0) {
        sender.sendMessage(
            Notices.info(
                "Rent: "
                    + def.weeklyRent()
                    + " CR/week, manual renewal. "
                    + lease
                        .map(
                            value ->
                                "Paid through "
                                    + value.paidThrough()
                                    + "; seven-day grace follows.")
                        .orElseGet(() -> "Use /plot rent " + def.id() + ".")));
      }
    }
    return Command.SINGLE_SUCCESS;
  }

  private int pay(Player player, String id, boolean renew) {
    var _ =
        rentals
            .pay(player.getUniqueId(), id, renew)
            .whenCompleteAsync(
                (result, failure) -> {
                  if (failure != null) {
                    failed(player, failure);
                    return;
                  }
                  switch (result) {
                    case Result.Ok(var lease) ->
                        player.sendMessage(
                            Notices.info(
                                "Plot "
                                    + lease.parcelId()
                                    + " is paid through "
                                    + lease.paidThrough()
                                    + ". Use /plot renew "
                                    + lease.parcelId()
                                    + " to add a week."));
                    case Result.Err(var reason) -> player.sendMessage(Notices.error(reason));
                  }
                },
                parts.context().scheduler().mainThread());
    return Command.SINGLE_SUCCESS;
  }

  private int start(
      CommandSender sender, Supplier<CompletableFuture<Void>> action, String success) {
    try {
      var _ =
          action
              .get()
              .whenCompleteAsync(
                  (ignored, failure) -> {
                    if (failure == null) {
                      sender.sendMessage(Notices.info(success));
                    } else {
                      failed(sender, failure);
                    }
                  },
                  parts.context().scheduler().mainThread());
    } catch (IllegalArgumentException e) {
      sender.sendMessage(
          Notices.error(e.getMessage() == null ? "Invalid plot command." : e.getMessage()));
    }
    return Command.SINGLE_SUCCESS;
  }

  private int reconcile(CommandSender sender, String id) {
    UUID operation;
    try {
      operation = UUID.fromString(id);
    } catch (IllegalArgumentException e) {
      sender.sendMessage(parts.protocol().prefix() + " INVALID");
      return Command.SINGLE_SUCCESS;
    }
    if (!operations.containsKey(operation)) {
      operations.put(operation, "RUNNING");
      var _ =
          resetting
              .reconcile()
              .whenCompleteAsync(
                  (result, failure) -> {
                    operations.put(operation, failure == null ? result : "FAILED");
                    if (failure != null) {
                      parts
                          .context()
                          .logger()
                          .error(
                              "Plot reconciliation {} failed; journals remain protected",
                              operation,
                              failure);
                    }
                  },
                  parts.context().scheduler().mainThread());
      if (operations.size() > 256) {
        var first = operations.firstEntry();
        if (first != null && !first.getValue().equals("RUNNING")) {
          operations.remove(first.getKey());
        }
      }
    }
    return status(sender, id);
  }

  private int status(CommandSender sender, String id) {
    try {
      var operation = UUID.fromString(id);
      sender.sendMessage(
          parts.protocol().prefix()
              + " "
              + operation
              + " "
              + operations.getOrDefault(operation, "UNKNOWN"));
    } catch (IllegalArgumentException e) {
      sender.sendMessage(parts.protocol().prefix() + " INVALID");
    }
    return Command.SINGLE_SUCCESS;
  }

  private void failed(CommandSender sender, Throwable failure) {
    parts.context().logger().warn("Plot operation failed", failure);
    var cause = failure;
    while (cause.getCause() != null) {
      cause = cause.getCause();
    }
    sender.sendMessage(
        Notices.error(
            cause instanceof IllegalArgumentException && cause.getMessage() != null
                ? cause.getMessage()
                : "Plot operation needs reconciliation. Any saved shop archive is retained."));
  }
}
