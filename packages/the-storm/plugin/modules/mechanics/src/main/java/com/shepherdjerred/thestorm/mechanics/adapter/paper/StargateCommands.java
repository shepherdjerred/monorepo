package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import static com.mojang.brigadier.arguments.StringArgumentType.getString;
import static com.mojang.brigadier.arguments.StringArgumentType.string;
import static com.mojang.brigadier.arguments.StringArgumentType.word;

import com.mojang.brigadier.Command;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.players.PlayerDirectory;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.mechanics.app.StargateAccess;
import com.shepherdjerred.thestorm.mechanics.app.StargateBook;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.NetworkAccess;
import com.shepherdjerred.thestorm.mechanics.domain.stargate.StargateNetwork;
import com.shepherdjerred.thestorm.towns.app.TownMembership;
import io.papermc.paper.command.brigadier.Commands;
import java.util.HashSet;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import net.kyori.adventure.text.Component;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

/** Commands for naming networks and managing private network invitations. */
final class StargateCommands {
  private final ModuleContext context;
  private final StargateBook book;
  private final StargateAccess access;
  private final TownMembership towns;
  private final PlayerDirectory players;
  private final StargatePortals portals;
  private final Protection protection;

  StargateCommands(
      ModuleContext context, StargateBook book, StargateAccess access, StargatePortals portals) {
    this.context = context;
    this.book = book;
    this.access = access;
    this.towns = context.services().require(TownMembership.class);
    this.players = context.services().require(PlayerDirectory.class);
    this.portals = portals;
    this.protection = context.services().require(Protection.class);
  }

  void register(Commands commands) {
    var root = Commands.literal("stargate").executes(call -> help(call.getSource().getSender()));
    var network = Commands.literal("network");
    var create = Commands.literal("create");
    for (var kind : new String[] {"public", "private", "town"}) {
      create.then(
          Commands.literal(kind)
              .then(
                  Commands.argument("name", string())
                      .executes(
                          call ->
                              create(
                                  call.getSource().getSender(), kind, getString(call, "name")))));
    }
    network.then(create);
    for (var verb : new String[] {"invite", "uninvite"}) {
      network.then(
          Commands.literal(verb)
              .then(
                  Commands.argument("network", string())
                      .then(
                          Commands.argument("player", word())
                              .executes(
                                  call ->
                                      invite(
                                          call.getSource().getSender(),
                                          getString(call, "network"),
                                          getString(call, "player"),
                                          verb.equals("invite"))))));
    }
    root.then(network);
    root.then(
        Commands.literal("remove")
            .then(
                Commands.argument("network", string())
                    .then(
                        Commands.argument("gate", string())
                            .executes(
                                call ->
                                    remove(
                                        call.getSource().getSender(),
                                        getString(call, "network"),
                                        getString(call, "gate"))))));
    commands.register(root.build(), "Manage Stargate networks");
  }

  private int help(CommandSender sender) {
    sender.sendMessage(Component.text("Build the small obsidian frame or the seven-block circle."));
    sender.sendMessage(
        Component.text("Place a wall sign and button on opposite middle side blocks."));
    sender.sendMessage(
        Component.text("Sign: gate name on line 1, network name on line 3 (blank: central)."));
    sender.sendMessage(
        Component.text("Line 2: fixed destination. Line 4: A keeps a fixed gate open."));
    sender.sendMessage(
        Component.text("Use the sign to select a destination, then press the button."));
    sender.sendMessage(Component.text("/stargate network create <public|private|town> <name>"));
    sender.sendMessage(Component.text("/stargate network <invite|uninvite> <network> <player>"));
    sender.sendMessage(Component.text("/stargate remove <network> <gate>"));
    sender.sendMessage(
        Component.text("You may also remove your gate by breaking its frame, sign or button."));
    return Command.SINGLE_SUCCESS;
  }

  private int remove(CommandSender sender, String networkName, String gateName) {
    if (!(sender instanceof Player player))
      return fail(sender, "Only players can remove Stargates.");
    if (!book.ready()) return fail(sender, "Stargates are loading or saving; try again.");
    var network = book.registry().network(networkName);
    if (network.isEmpty()) return fail(sender, "No such Stargate network.");
    var gate = book.registry().gate(network.orElseThrow().id(), gateName);
    if (gate.isEmpty()) return fail(sender, "No such Stargate on that network.");
    var value = gate.orElseThrow();
    var policy = network.orElseThrow().access();
    var authorized =
        policy instanceof NetworkAccess.Public
            ? player.getUniqueId().equals(value.ownerId())
            : access.mayUse(player, policy);
    if (!authorized) return fail(sender, "You cannot manage this Stargate.");
    var world = context.plugin().getServer().getWorld(value.worldId());
    if (world == null || !portals.canRemove(value)) {
      return fail(sender, "Visit the gate and wait for its portal to close before removing it.");
    }
    var grid = new PaperGrid(world);
    var cells = new java.util.ArrayList<>(value.frame().frameBlocks());
    cells.addAll(value.frame().interior());
    cells.add(value.sign());
    cells.add(value.button());
    if (!new Guard(protection).cells(player.getUniqueId(), grid, cells).isAllowed()) {
      return fail(sender, "You cannot change all of this Stargate's blocks.");
    }
    complete(player, book.deleteGate(value.id()), "Removed Stargate " + value.name() + ".");
    return Command.SINGLE_SUCCESS;
  }

  private int create(CommandSender sender, String kind, String name) {
    if (!portals.enabled()) return fail(sender, "Stargates are not available right now.");
    if (!(sender instanceof Player player))
      return fail(sender, "Only players can create networks.");
    if (!book.ready()) return fail(sender, "Stargates are loading or saving; try again.");
    NetworkAccess policy;
    switch (kind) {
      case "public" -> policy = new NetworkAccess.Public();
      case "private" ->
          policy = new NetworkAccess.Private(player.getUniqueId(), java.util.Set.of());
      case "town" -> {
        var town = towns.townIdOf(player.getUniqueId());
        if (town.isEmpty()) return fail(sender, "You need to belong to a town.");
        policy = new NetworkAccess.Town(town.orElseThrow());
      }
      default -> throw new IllegalArgumentException("unknown network kind: " + kind);
    }
    if (!access.mayCreate(player, policy))
      return fail(sender, "You need Mechanic III and access to this network.");
    try {
      var id = new UUID(context.random().nextLong(), context.random().nextLong());
      var value = new StargateNetwork(id, name, policy);
      complete(player, book.createNetwork(value), "Created network " + value.name() + ".");
      return Command.SINGLE_SUCCESS;
    } catch (IllegalArgumentException | IllegalStateException error) {
      return fail(sender, "That network name is invalid or already in use.");
    }
  }

  private int invite(CommandSender sender, String name, String playerName, boolean add) {
    if (!portals.enabled()) return fail(sender, "Stargates are not available right now.");
    if (!(sender instanceof Player player))
      return fail(sender, "Only players can manage invitations.");
    if (!book.ready()) return fail(sender, "Stargates are loading or saving; try again.");
    var network = book.registry().network(name);
    if (network.isEmpty() || !network.orElseThrow().access().mayInvite(player.getUniqueId())) {
      return fail(sender, "Only the private network owner can manage invitations.");
    }
    var networkId = network.orElseThrow().id();
    var _ =
        players
            .byName(playerName)
            .whenCompleteAsync(
                (found, error) -> {
                  if (!player.isOnline()) return;
                  if (error != null) {
                    context.logger().error("Could not look up a Stargate invitee", error);
                    fail(player, "Could not look up that player.");
                  } else if (found.isEmpty()) {
                    fail(player, "That player has not joined The Storm.");
                  } else {
                    applyInvite(player, networkId, found.orElseThrow(), add);
                  }
                },
                context.scheduler().mainThread());
    return Command.SINGLE_SUCCESS;
  }

  private void applyInvite(
      Player player,
      UUID networkId,
      com.shepherdjerred.thestorm.core.players.KnownPlayer invitee,
      boolean add) {
    if (!portals.enabled()) {
      fail(player, "Stargates are not available right now.");
      return;
    }
    if (!book.ready()) {
      fail(player, "Stargates are loading or saving; try again.");
      return;
    }
    var network = book.registry().network(networkId);
    if (network.isEmpty()
        || !(network.orElseThrow().access()
            instanceof NetworkAccess.Private(var owner, var members))
        || !owner.equals(player.getUniqueId())) {
      fail(player, "You no longer manage this network.");
      return;
    }
    var next = new HashSet<>(members);
    if (add) next.add(invitee.uuid());
    else next.remove(invitee.uuid());
    complete(
        player,
        book.replaceInvitations(networkId, next),
        (add ? "Invited " : "Removed ") + invitee.lastName() + ".");
  }

  private void complete(Player player, CompletableFuture<Void> pending, String success) {
    var _ =
        pending.whenCompleteAsync(
            (ignored, failure) -> {
              if (failure != null) {
                context.logger().error("Could not save Stargate state", failure);
                if (player.isOnline())
                  fail(player, "Could not save the Stargate change; try again.");
              } else if (player.isOnline()) {
                player.sendMessage(Component.text(success));
              }
            },
            context.scheduler().mainThread());
  }

  private static int fail(CommandSender sender, String message) {
    sender.sendMessage(Component.text(message));
    return 0;
  }
}
