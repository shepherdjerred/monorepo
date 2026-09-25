package com.shepherdjerred.thestorm.essentials.adapter.paper;

import static com.mojang.brigadier.arguments.StringArgumentType.word;
import static io.papermc.paper.command.brigadier.Commands.argument;
import static io.papermc.paper.command.brigadier.Commands.literal;

import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.core.text.HouseStyle;
import com.shepherdjerred.thestorm.essentials.app.TpaDesk;
import com.shepherdjerred.thestorm.essentials.domain.place.DurationText;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportKind;
import com.shepherdjerred.thestorm.essentials.domain.tpa.TpaError;
import com.shepherdjerred.thestorm.essentials.domain.tpa.TpaRequest;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.command.brigadier.Commands;
import java.time.Duration;
import java.util.Optional;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.event.ClickEvent;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.entity.Player;

/**
 * {@code /tpa}, {@code /tpahere}, {@code /tpaccept} and {@code /tpdeny}. The player who asks pays
 * when the request is accepted.
 */
final class TpaCommands {

  private final PaperRuntime runtime;
  private final TeleportFlow flow;
  private final TpaDesk desk;
  private final Duration timeout;

  TpaCommands(PaperRuntime runtime, TeleportFlow flow, TpaDesk desk, Duration timeout) {
    this.runtime = runtime;
    this.flow = flow;
    this.desk = desk;
    this.timeout = timeout;
  }

  void register(Commands commands) {
    commands.register(
        request("tpa", TpaRequest.Direction.TO_TARGET).build(), "Ask to teleport to a player");
    commands.register(
        request("tpahere", TpaRequest.Direction.TO_REQUESTER).build(),
        "Ask a player to teleport to you");
    commands.register(answer("tpaccept", true).build(), "Accept a teleport request");
    commands.register(answer("tpdeny", false).build(), "Deny a teleport request");
  }

  /** Tells both players about requests that lapsed. Runs periodically on the main thread. */
  void expire() {
    for (var request : desk.expire()) {
      online(request.requester())
          .ifPresent(p -> Say.info(p, Say.TELEPORT, "Your teleport request expired."));
      online(request.target())
          .ifPresent(p -> Say.info(p, Say.TELEPORT, "A teleport request to you expired."));
    }
  }

  private LiteralArgumentBuilder<CommandSourceStack> request(
      String name, TpaRequest.Direction direction) {
    return literal(name)
        .requires(Cmd.permission(EssentialsPermissions.TPA))
        .then(
            argument("player", word())
                .suggests(Cmd.onlinePlayers(runtime.server()))
                .executes(
                    context ->
                        Cmd.asPlayer(
                            context,
                            player -> send(player, Cmd.string(context, "player"), direction))));
  }

  private LiteralArgumentBuilder<CommandSourceStack> answer(String name, boolean accept) {
    return literal(name)
        .requires(Cmd.permission(EssentialsPermissions.TPA))
        .executes(
            context -> Cmd.asPlayer(context, player -> take(player, Optional.empty(), accept)))
        .then(
            argument("player", word())
                .suggests(Cmd.onlinePlayers(runtime.server()))
                .executes(
                    context ->
                        Cmd.asPlayer(
                            context,
                            player -> takeFrom(player, Cmd.string(context, "player"), accept))));
  }

  private void send(Player requester, String targetName, TpaRequest.Direction direction) {
    var target = runtime.server().getPlayerExact(targetName);
    if (target == null) {
      Say.error(requester, Say.TELEPORT, targetName + " is not online.");
      return;
    }
    switch (desk.send(requester.getUniqueId(), target.getUniqueId(), direction)) {
      case Result.Ok<TpaRequest, TpaError> _ -> {
        Say.success(
            requester,
            Say.TELEPORT,
            "Request sent to "
                + target.getName()
                + ". It expires in "
                + DurationText.format(timeout)
                + ".");
        notifyTarget(target, requester, direction);
      }
      case Result.Err<TpaRequest, TpaError>(var error) ->
          Say.error(requester, Say.TELEPORT, describe(error));
    }
  }

  private void notifyTarget(Player target, Player requester, TpaRequest.Direction direction) {
    var ask =
        switch (direction) {
          case TO_TARGET -> requester.getName() + " wants to teleport to you. ";
          case TO_REQUESTER -> requester.getName() + " wants you to teleport to them. ";
        };
    target.sendMessage(
        HouseStyle.info(
            Say.TELEPORT,
            Component.text(ask)
                .append(
                    button("[Accept]", "/tpaccept " + requester.getName(), NamedTextColor.GREEN))
                .append(Component.text(" "))
                .append(button("[Deny]", "/tpdeny " + requester.getName(), NamedTextColor.RED))));
  }

  private void takeFrom(Player target, String requesterName, boolean accept) {
    var requester = runtime.server().getPlayerExact(requesterName);
    if (requester == null) {
      Say.error(target, Say.TELEPORT, requesterName + " is not online.");
      return;
    }
    take(target, Optional.of(requester.getUniqueId()), accept);
  }

  private void take(Player target, Optional<UUID> requester, boolean accept) {
    switch (desk.take(target.getUniqueId(), requester)) {
      case Result.Ok<TpaRequest, TpaError>(var request) -> {
        if (accept) {
          accept(target, request);
        } else {
          Say.info(target, Say.TELEPORT, "Request denied.");
          online(request.requester())
              .ifPresent(
                  p -> Say.error(p, Say.TELEPORT, target.getName() + " denied your request."));
        }
      }
      case Result.Err<TpaRequest, TpaError>(var error) ->
          Say.error(target, Say.TELEPORT, describe(error));
    }
  }

  private void accept(Player target, TpaRequest request) {
    var requester = online(request.requester());
    var mover = online(request.mover());
    var destination = online(request.destination());
    if (requester.isEmpty() || mover.isEmpty() || destination.isEmpty()) {
      Say.error(target, Say.TELEPORT, "That player is no longer online.");
      return;
    }
    Say.success(
        requester.orElseThrow(), Say.TELEPORT, target.getName() + " accepted your request.");
    flow.start(
        new Ticket(
            mover.orElseThrow(),
            requester.orElseThrow(),
            TeleportKind.TPA,
            Destination.player(destination.orElseThrow())));
  }

  private Optional<Player> online(UUID player) {
    return Optional.ofNullable(runtime.server().getPlayer(player));
  }

  private static Component button(String label, String command, NamedTextColor color) {
    return Component.text(label, color).clickEvent(ClickEvent.runCommand(command));
  }

  private static String describe(TpaError error) {
    return switch (error) {
      case TpaError.SelfRequest() -> "You can't send a teleport request to yourself.";
      case TpaError.NoPendingRequest() -> "You have no teleport requests.";
      case TpaError.NoRequestFrom(var _) -> "You have no teleport request from them.";
    };
  }
}
