package com.shepherdjerred.thestorm.towns.adapter.paper;

import static com.mojang.brigadier.arguments.LongArgumentType.getLong;
import static com.mojang.brigadier.arguments.LongArgumentType.longArg;

import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.economy.app.CrystalFormatter;
import com.shepherdjerred.thestorm.economy.app.Crystals;
import com.shepherdjerred.thestorm.towns.app.Treasury;
import com.shepherdjerred.thestorm.towns.domain.treasury.TreasuryProblem;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.command.brigadier.Commands;
import java.util.concurrent.CompletableFuture;
import java.util.function.Function;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import org.bukkit.entity.Player;

/**
 * {@code /town deposit <amount>}, {@code /town withdraw <amount>} (owners and assistants) and
 * {@code /town balance}: the town's treasury, an economy account.
 */
final class TreasuryCommands {

  private static final String AMOUNT = "amount";

  private final Treasury treasury;
  private final CrystalFormatter crystals;
  private final ComponentLogger logger;

  TreasuryCommands(Treasury treasury, CrystalFormatter crystals, ComponentLogger logger) {
    this.treasury = treasury;
    this.crystals = crystals;
    this.logger = logger;
  }

  /** Adds the treasury subcommands to {@code /town}. */
  void attach(LiteralArgumentBuilder<CommandSourceStack> town) {
    town.then(
            Commands.literal("deposit")
                .then(
                    Commands.argument(AMOUNT, longArg(1))
                        .executes(
                            context ->
                                TownCommands.asPlayer(
                                    context, player -> deposit(player, getLong(context, AMOUNT))))))
        .then(
            Commands.literal("withdraw")
                .then(
                    Commands.argument(AMOUNT, longArg(1))
                        .executes(
                            context ->
                                TownCommands.asPlayer(
                                    context,
                                    player -> withdraw(player, getLong(context, AMOUNT))))))
        .then(
            Commands.literal("balance")
                .executes(context -> TownCommands.asPlayer(context, this::balance)));
  }

  void deposit(Player player, long amount) {
    answer(
        player,
        treasury.deposit(player.getUniqueId(), Crystals.of(amount)),
        receipt -> "You paid " + crystals.words(receipt.amount()) + " into your town's treasury.");
  }

  void withdraw(Player player, long amount) {
    answer(
        player,
        treasury.withdraw(player.getUniqueId(), Crystals.of(amount)),
        receipt -> "You took " + crystals.words(receipt.amount()) + " from your town's treasury.");
  }

  void balance(Player player) {
    answer(
        player,
        treasury.balance(player.getUniqueId()),
        balance -> "Your town's treasury holds " + crystals.words(balance) + ".");
  }

  private <T> void answer(
      Player player,
      CompletableFuture<Result<T, TreasuryProblem>> pending,
      Function<T, String> success) {
    var _ =
        pending.whenComplete(
            (result, failure) -> {
              if (failure != null) {
                logger.error("A treasury request failed", failure);
                player.sendMessage(Notices.error("The treasury could not be reached; try again."));
                return;
              }
              switch (result) {
                case Result.Ok<T, TreasuryProblem>(var value) ->
                    player.sendMessage(Notices.success(success.apply(value)));
                case Result.Err<T, TreasuryProblem>(var problem) ->
                    player.sendMessage(Notices.error(explain(problem)));
              }
            });
  }

  private String explain(TreasuryProblem problem) {
    return switch (problem) {
      case TreasuryProblem.NotInTown() -> "You are not in a town.";
      case TreasuryProblem.CannotWithdraw(var _) ->
          "Only a town's owner or assistants take money out; members pay in.";
      case TreasuryProblem.Insufficient(var balance) ->
          "There are only " + crystals.words(Crystals.of(balance)) + " to pay with.";
      case TreasuryProblem.Busy() -> "Your town is being changed; try again in a moment.";
    };
  }
}
