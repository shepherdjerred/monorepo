package com.shepherdjerred.thestorm.towns.adapter.paper;

import com.mojang.brigadier.tree.LiteralCommandNode;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.towns.app.Change;
import com.shepherdjerred.thestorm.towns.app.PvpService;
import com.shepherdjerred.thestorm.towns.domain.Explanations;
import com.shepherdjerred.thestorm.towns.domain.pvp.PvpProblem;
import com.shepherdjerred.thestorm.towns.domain.pvp.PvpSetting;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.command.brigadier.Commands;
import java.time.Duration;
import org.bukkit.entity.Player;

/**
 * {@code /pvp on|off|status}: each player's own PvP switch. Everyone starts with PvP on; a player
 * with it off cannot hurt other players or be hurt by them, anywhere. It may change once per
 * cooldown (a week on the live server).
 */
final class PvpCommands {

  private final PvpService pvp;
  private final TownCommands.Services runtime;

  PvpCommands(PvpService pvp, TownCommands.Services runtime) {
    this.pvp = pvp;
    this.runtime = runtime;
  }

  void register(Commands commands) {
    commands.register(root(), "Turns your own PvP on or off, or shows it");
  }

  private LiteralCommandNode<CommandSourceStack> root() {
    return Commands.literal("pvp")
        .executes(context -> TownCommands.asPlayer(context, this::status))
        .then(
            Commands.literal("on")
                .executes(context -> TownCommands.asPlayer(context, player -> set(player, true))))
        .then(
            Commands.literal("off")
                .executes(context -> TownCommands.asPlayer(context, player -> set(player, false))))
        .then(
            Commands.literal("status")
                .executes(context -> TownCommands.asPlayer(context, this::status)))
        .build();
  }

  void status(Player player) {
    var on = pvp.pvpOn(player.getUniqueId());
    var next = pvp.nextChange(player.getUniqueId());
    var when =
        next.map(
                at ->
                    "You can change it again in "
                        + Explanations.wait(Duration.between(pvp.now(), at))
                        + ".")
            .orElseGet(() -> "You can change it now with /pvp " + (on ? "off" : "on") + ".");
    player.sendMessage(Notices.info("Your PvP is " + (on ? "on" : "off") + ". " + when));
  }

  void set(Player player, boolean on) {
    var result = pvp.set(player.getUniqueId(), on);
    switch (result) {
      case Result.Ok<Change<PvpSetting>, PvpProblem>(var change) ->
          runtime.whenSaved(
              player,
              change.saved(),
              Notices.success(
                  on
                      ? "Your PvP is on: you can fight other players where PvP is allowed."
                      : "Your PvP is off: no player can hurt you, and you can't hurt them."));
      case Result.Err<Change<PvpSetting>, PvpProblem>(var problem) ->
          player.sendMessage(Notices.error(Explanations.explain(problem, pvp.now())));
    }
  }
}
