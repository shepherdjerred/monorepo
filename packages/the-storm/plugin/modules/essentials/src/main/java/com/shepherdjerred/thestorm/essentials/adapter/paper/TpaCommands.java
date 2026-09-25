package com.shepherdjerred.thestorm.essentials.adapter.paper;

import static com.mojang.brigadier.arguments.LongArgumentType.longArg;
import static com.mojang.brigadier.arguments.StringArgumentType.word;
import static io.papermc.paper.command.brigadier.Commands.argument;
import static io.papermc.paper.command.brigadier.Commands.literal;

import com.mojang.brigadier.arguments.LongArgumentType;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.core.text.HouseStyle;
import com.shepherdjerred.thestorm.essentials.app.TpaDesk;
import com.shepherdjerred.thestorm.essentials.domain.place.DurationText;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportKind;
import com.shepherdjerred.thestorm.essentials.domain.tpa.TpaError;
import com.shepherdjerred.thestorm.essentials.domain.tpa.TpaRequest;
import com.shepherdjerred.thestorm.essentials.domain.tpa.TpaSelector;
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
 * {@code /tpa}, {@code /tpahere}, {@code /tpaccept}, {@code /tpdeny} and {@code /tptoggle}. The
 * player who asks pays when the request is accepted. The clickable buttons name the exact request
 * (requester and id), so a requester cannot swap a {@code /tpa} for a {@code /tpahere} under the
 * target's click.
 */
final class TpaCommands {

  private static final String PLAYER = "player";
  private static final String ID = "id";

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
    commands.register(
        literal("tptoggle")
            .requires(Cmd.permission(EssentialsPermissions.TPA))
            .executes(context -> Cmd.asPlayer(context, this::toggle))
            .build(),
        "Turn teleport requests to you on or off");
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
            argument(PLAYER, word())
                .suggests(Cmd.onlinePlayers(runtime.server()))
                .executes(
                    context ->
                        Cmd.asPlayer(
                            context,
                            player -> send(player, Cmd.string(context, PLAYER), direction))));
  }

  private LiteralArgumentBuilder<CommandSourceStack> answer(String name, boolean accept) {
    return literal(name)
        .requires(Cmd.permission(EssentialsPermissions.TPA))
        .executes(
            context -> Cmd.asPlayer(context, player -> answer(player, Optional.empty(), accept)))
        .then(
            argument(PLAYER, word())
                .suggests(Cmd.onlinePlayers(runtime.server()))
                .executes(
                    context ->
                        Cmd.asPlayer(
                            context,
                            player ->
                                answerFrom(
                                    player, Cmd.string(context, PLAYER), Optional.empty(), accept)))
                .then(
                    argument(ID, longArg(1))
                        .executes(
                            context ->
                                Cmd.asPlayer(
                                    context,
                                    player ->
                                        answerFrom(
                                            player,
                                            Cmd.string(context, PLAYER),
                                            Optional.of(LongArgumentType.getLong(context, ID)),
                                            accept)))));
  }

  private void toggle(Player player) {
    if (desk.toggle(player.getUniqueId())) {
      Say.success(player, Say.TELEPORT, "Players can send you teleport requests again.");
    } else {
      Say.info(
          player, Say.TELEPORT, "Teleport requests to you are now off. /tptoggle turns them on.");
    }
  }

  private void send(Player requester, String targetName, TpaRequest.Direction direction) {
    var target = runtime.server().getPlayerExact(targetName);
    if (target == null) {
      Say.error(requester, Say.TELEPORT, targetName + " is not online.");
      return;
    }
    switch (desk.send(requester.getUniqueId(), target.getUniqueId(), direction)) {
      case Result.Ok<TpaRequest, TpaError>(var request) -> {
        Say.success(
            requester,
            Say.TELEPORT,
            "Request sent to "
                + target.getName()
                + ". It expires in "
                + DurationText.format(timeout)
                + ".");
        notifyTarget(target, requester, request);
      }
      case Result.Err<TpaRequest, TpaError>(var error) ->
          Say.error(requester, Say.TELEPORT, describe(error));
    }
  }

  private void notifyTarget(Player target, Player requester, TpaRequest request) {
    var ask =
        switch (request.direction()) {
          case TO_TARGET -> requester.getName() + " wants to teleport to you. ";
          case TO_REQUESTER -> requester.getName() + " wants you to teleport to them. ";
        };
    var exact = requester.getName() + " " + request.id();
    target.sendMessage(
        HouseStyle.info(
            Say.TELEPORT,
            Component.text(ask)
                .append(button("[Accept]", "/tpaccept " + exact, NamedTextColor.GREEN))
                .append(Component.text(" "))
                .append(button("[Deny]", "/tpdeny " + exact, NamedTextColor.RED))));
  }

  private void answerFrom(Player target, String requesterName, Optional<Long> id, boolean accept) {
    var requester = runtime.server().getPlayerExact(requesterName);
    if (requester == null) {
      Say.error(target, Say.TELEPORT, requesterName + " is not online.");
      return;
    }
    var from = requester.getUniqueId();
    answer(
        target,
        Optional.of(
            id.<TpaSelector>map(n -> new TpaSelector.Exact(from, n))
                .orElseGet(() -> new TpaSelector.From(from))),
        accept);
  }

  private void answer(Player target, Optional<TpaSelector> selector, boolean accept) {
    var chosen = selector.orElseGet(TpaSelector.Newest::new);
    switch (desk.peek(target.getUniqueId(), chosen)) {
      case Result.Err<TpaRequest, TpaError>(var error) ->
          Say.error(target, Say.TELEPORT, describe(error));
      case Result.Ok<TpaRequest, TpaError>(var request) -> {
        if (accept) {
          accept(target, request, chosen);
        } else {
          var _ = desk.take(target.getUniqueId(), chosen);
          Say.info(target, Say.TELEPORT, "Request denied.");
          online(request.requester())
              .ifPresent(
                  p -> Say.error(p, Say.TELEPORT, target.getName() + " denied your request."));
        }
      }
    }
  }

  private void accept(Player target, TpaRequest request, TpaSelector chosen) {
    var requester = online(request.requester());
    var mover = online(request.mover());
    var destination = online(request.destination());
    if (requester.isEmpty() || mover.isEmpty() || destination.isEmpty()) {
      Say.error(target, Say.TELEPORT, "That player is no longer online.");
      return;
    }
    if (flow.isBusy(request.requester()) || flow.isBusy(request.target())) {
      Say.error(
          target,
          Say.TELEPORT,
          "One of you is already teleporting. The request stays open; accept it again shortly.");
      return;
    }
    var _ = desk.take(target.getUniqueId(), chosen);
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
      case TpaError.NotAccepting() -> "That player isn't accepting teleport requests.";
      case TpaError.TooSoon(var remaining) ->
          "Wait " + DurationText.format(remaining) + " before sending another request.";
      case TpaError.Conflicting(var pending) ->
          switch (pending) {
            case TO_TARGET -> "You already asked to teleport to them; wait for an answer.";
            case TO_REQUESTER -> "You already asked them to teleport to you; wait for an answer.";
          };
      case TpaError.NoPendingRequest() -> "You have no teleport requests.";
      case TpaError.NoRequestFrom(var _) -> "You have no teleport request from them.";
      case TpaError.NoSuchRequest(var _) ->
          "That request is no longer open; it was replaced or has expired.";
    };
  }
}
