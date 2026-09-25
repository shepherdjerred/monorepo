package com.shepherdjerred.thestorm.economy.adapter.paper;

import static com.mojang.brigadier.arguments.LongArgumentType.getLong;
import static com.mojang.brigadier.arguments.LongArgumentType.longArg;
import static com.mojang.brigadier.arguments.StringArgumentType.getString;
import static com.mojang.brigadier.arguments.StringArgumentType.word;

import com.mojang.brigadier.Command;
import com.mojang.brigadier.builder.RequiredArgumentBuilder;
import com.mojang.brigadier.tree.LiteralCommandNode;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.Crystals;
import com.shepherdjerred.thestorm.economy.app.EconomyError;
import com.shepherdjerred.thestorm.economy.app.LedgerWallets;
import com.shepherdjerred.thestorm.economy.app.Receipt;
import com.shepherdjerred.thestorm.economy.domain.CrystalFormat;
import com.shepherdjerred.thestorm.economy.domain.Explanations;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.command.brigadier.Commands;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;
import org.bukkit.Server;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

/**
 * {@code /balance} ({@code /bal}), {@code /pay}, {@code /baltop} and the administrators' {@code
 * /eco give|take|set}. Every change is a ledgered transfer; {@code /eco} moves crystals to or from
 * the server and records the administrator's name in the reason.
 */
final class EconomyCommands {

  static final String ADMIN_PERMISSION = "thestorm.economy.admin";

  /** The largest amount one command may move, far above any real balance. */
  static final long MAX_AMOUNT = 1_000_000_000_000L;

  private static final String PLAYER = "player";
  private static final String AMOUNT = "amount";

  private final LedgerWallets wallets;
  private final CrystalFormat format;
  private final int baltopSize;
  private final Paper paper;

  /**
   * The Paper services the commands use.
   *
   * @param server the server, for looking players up
   * @param replies messages and main-thread completion
   */
  record Paper(Server server, Replies replies) {}

  EconomyCommands(LedgerWallets wallets, CrystalFormat format, int baltopSize, Paper paper) {
    this.wallets = wallets;
    this.format = format;
    this.baltopSize = baltopSize;
    this.paper = paper;
  }

  void register(Commands commands) {
    commands.register(balance(), "Shows a crystal balance", List.of("bal"));
    commands.register(pay(), "Pays crystals to another player");
    commands.register(baltop(), "Lists the richest players");
    commands.register(eco(), "Gives, takes or sets a player's crystals");
  }

  private LiteralCommandNode<CommandSourceStack> balance() {
    return Commands.literal("balance")
        .executes(context -> ownBalance(context.getSource().getSender()))
        .then(
            playerArgument()
                .executes(
                    context ->
                        otherBalance(context.getSource().getSender(), getString(context, PLAYER))))
        .build();
  }

  private LiteralCommandNode<CommandSourceStack> pay() {
    return Commands.literal("pay")
        .then(
            playerArgument()
                .then(
                    Commands.argument(AMOUNT, longArg(1, MAX_AMOUNT))
                        .executes(
                            context ->
                                pay(
                                    context.getSource().getSender(),
                                    getString(context, PLAYER),
                                    new Crystals(getLong(context, AMOUNT))))))
        .build();
  }

  private LiteralCommandNode<CommandSourceStack> baltop() {
    return Commands.literal("baltop")
        .executes(context -> baltop(context.getSource().getSender()))
        .build();
  }

  private LiteralCommandNode<CommandSourceStack> eco() {
    return Commands.literal("eco")
        .requires(source -> source.getSender().hasPermission(ADMIN_PERMISSION))
        .then(Commands.literal("give").then(adminAction(1, this::give)))
        .then(Commands.literal("take").then(adminAction(1, this::take)))
        .then(Commands.literal("set").then(adminAction(0, this::set)))
        .build();
  }

  private RequiredArgumentBuilder<CommandSourceStack, String> playerArgument() {
    return Commands.argument(PLAYER, word())
        .suggests((context, builder) -> KnownPlayer.suggest(paper.server(), builder));
  }

  private RequiredArgumentBuilder<CommandSourceStack, String> adminAction(
      long minimum, AdminAction action) {
    return playerArgument()
        .then(
            Commands.argument(AMOUNT, longArg(minimum, MAX_AMOUNT))
                .executes(
                    context -> {
                      var sender = context.getSource().getSender();
                      withPlayer(
                          sender,
                          getString(context, PLAYER),
                          target ->
                              action.run(sender, target, new Crystals(getLong(context, AMOUNT))));
                      return Command.SINGLE_SUCCESS;
                    }));
  }

  private int ownBalance(CommandSender sender) {
    if (!(sender instanceof Player player)) {
      sender.sendMessage(Replies.error("Name a player: /balance <player>"));
      return Command.SINGLE_SUCCESS;
    }
    paper
        .replies()
        .whenDone(
            wallets.balance(new AccountId.Player(player.getUniqueId())),
            sender,
            balance -> sender.sendMessage(Replies.info("Balance: " + format.words(balance))));
    return Command.SINGLE_SUCCESS;
  }

  private int otherBalance(CommandSender sender, String name) {
    withPlayer(
        sender,
        name,
        target ->
            paper
                .replies()
                .whenDone(
                    wallets.balance(target.account()),
                    sender,
                    balance ->
                        sender.sendMessage(
                            Replies.info(target.name() + " has " + format.words(balance) + "."))));
    return Command.SINGLE_SUCCESS;
  }

  private int pay(CommandSender sender, String name, Crystals amount) {
    if (!(sender instanceof Player payer)) {
      sender.sendMessage(Replies.error("Only players can pay; use /eco give instead."));
      return Command.SINGLE_SUCCESS;
    }
    withPlayer(
        sender,
        name,
        target ->
            whenTransferred(
                sender,
                wallets.transfer(
                    new AccountId.Player(payer.getUniqueId()), target.account(), amount, "pay"),
                receipt -> {
                  var words = format.words(receipt.amount());
                  sender.sendMessage(
                      Replies.success("You paid " + target.name() + " " + words + "."));
                  var online = paper.server().getPlayer(target.uuid());
                  if (online != null) {
                    online.sendMessage(
                        Replies.success(payer.getName() + " paid you " + words + "."));
                  }
                }));
    return Command.SINGLE_SUCCESS;
  }

  private int baltop(CommandSender sender) {
    paper
        .replies()
        .whenDone(
            wallets.top(baltopSize),
            sender,
            standings -> {
              if (standings.isEmpty()) {
                sender.sendMessage(Replies.info("Nobody holds any crystals yet."));
                return;
              }
              sender.sendMessage(Replies.info("Richest players:"));
              var rank = 1;
              for (var standing : standings) {
                var name = KnownPlayer.nameOf(paper.server(), standing.account().uuid());
                sender.sendMessage(
                    Replies.info(
                        "#" + rank + " " + name + " " + format.symbol(standing.balance())));
                rank++;
              }
            });
    return Command.SINGLE_SUCCESS;
  }

  private void give(CommandSender admin, KnownPlayer target, Crystals amount) {
    whenTransferred(
        admin,
        wallets.transfer(
            new AccountId.Server(), target.account(), amount, adminReason("give", admin)),
        receipt ->
            admin.sendMessage(
                Replies.success(
                    "Gave " + target.name() + " " + format.words(receipt.amount()) + ".")));
  }

  private void take(CommandSender admin, KnownPlayer target, Crystals amount) {
    whenTransferred(
        admin,
        wallets.transfer(
            target.account(), new AccountId.Server(), amount, adminReason("take", admin)),
        receipt ->
            admin.sendMessage(
                Replies.success(
                    "Took " + format.words(receipt.amount()) + " from " + target.name() + ".")));
  }

  private void set(CommandSender admin, KnownPlayer target, Crystals amount) {
    paper
        .replies()
        .whenDone(
            wallets.setBalance(target.account(), amount, adminReason("set", admin)),
            admin,
            receipt -> {
              var words = format.words(amount);
              admin.sendMessage(
                  receipt.isPresent()
                      ? Replies.success("Set " + target.name() + " to " + words + ".")
                      : Replies.info(target.name() + " already has " + words + "."));
            });
  }

  private void withPlayer(CommandSender sender, String name, Consumer<KnownPlayer> action) {
    KnownPlayer.find(paper.server(), name)
        .ifPresentOrElse(
            action,
            () -> sender.sendMessage(Replies.error("No player named " + name + " has joined.")));
  }

  private void whenTransferred(
      CommandSender sender,
      CompletableFuture<Result<Receipt, EconomyError>> transfer,
      Consumer<Receipt> onSuccess) {
    paper
        .replies()
        .whenDone(
            transfer,
            sender,
            result -> {
              switch (result) {
                case Result.Ok<Receipt, EconomyError>(var receipt) -> onSuccess.accept(receipt);
                case Result.Err<Receipt, EconomyError>(var error) ->
                    sender.sendMessage(Replies.error(Explanations.explain(error, format)));
              }
            });
  }

  private static String adminReason(String action, CommandSender admin) {
    return "eco-" + action + " by " + admin.getName();
  }

  /** One {@code /eco} subcommand, run once the target player is known. */
  @FunctionalInterface
  private interface AdminAction {
    void run(CommandSender admin, KnownPlayer target, Crystals amount);
  }
}
