package com.shepherdjerred.thestorm.economy.adapter.paper;

import static com.mojang.brigadier.arguments.LongArgumentType.getLong;
import static com.mojang.brigadier.arguments.LongArgumentType.longArg;
import static com.mojang.brigadier.arguments.StringArgumentType.getString;
import static com.mojang.brigadier.arguments.StringArgumentType.word;

import com.mojang.brigadier.Command;
import com.mojang.brigadier.builder.RequiredArgumentBuilder;
import com.mojang.brigadier.context.CommandContext;
import com.mojang.brigadier.suggestion.Suggestions;
import com.mojang.brigadier.suggestion.SuggestionsBuilder;
import com.mojang.brigadier.tree.LiteralCommandNode;
import com.shepherdjerred.thestorm.core.analytics.ProductAnalytics;
import com.shepherdjerred.thestorm.core.players.PlayerDirectory;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.CurrencyId;
import com.shepherdjerred.thestorm.economy.app.EconomyError;
import com.shepherdjerred.thestorm.economy.app.LedgerWallets;
import com.shepherdjerred.thestorm.economy.app.Money;
import com.shepherdjerred.thestorm.economy.app.RankedPlayer;
import com.shepherdjerred.thestorm.economy.app.Receipt;
import com.shepherdjerred.thestorm.economy.app.SeenPlayer;
import com.shepherdjerred.thestorm.economy.domain.Explanations;
import com.shepherdjerred.thestorm.economy.domain.MoneyFormat;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.command.brigadier.Commands;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;
import java.util.function.ToIntFunction;
import java.util.stream.Collectors;
import net.kyori.adventure.text.Component;
import org.bukkit.Server;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

/**
 * {@code /balance} ({@code /bal}), {@code /pay}, {@code /baltop [currency]} and the administrators'
 * {@code /eco give|take|set <player> <amount> [currency]}. Every change is a ledgered transfer;
 * {@code /eco} moves money to or from the server and records the administrator's name in the
 * reason. {@code /balance} lists every currency; {@code /pay} moves crystals only, and {@code
 * /baltop} and {@code /eco} use crystals unless a currency is named.
 *
 * <p>A named player is found among online players first, then in the shared player directory (read
 * off the main thread). Players who have never joined cannot be paid or looked up.
 */
final class EconomyCommands {

  static final String ADMIN_PERMISSION = "thestorm.economy.admin";

  /** The largest amount one command may move, far above any real balance. */
  static final long MAX_AMOUNT = 1_000_000_000_000L;

  private static final String PLAYER = "player";
  private static final String AMOUNT = "amount";
  private static final String CURRENCY = "currency";

  private final LedgerWallets wallets;
  private final MoneyFormat format;
  private final int baltopSize;
  private final Paper paper;

  /**
   * The Paper services the commands use.
   *
   * @param server the server, for online players
   * @param replies messages and main-thread completion
   */
  record Paper(
      Server server, Replies replies, PlayerDirectory players, ProductAnalytics analytics) {}

  EconomyCommands(LedgerWallets wallets, MoneyFormat format, int baltopSize, Paper paper) {
    this.wallets = wallets;
    this.format = format;
    this.baltopSize = baltopSize;
    this.paper = paper;
  }

  void register(Commands commands) {
    commands.register(balance(), "Shows every balance", List.of("bal"));
    commands.register(pay(), "Pays crystals to another player");
    commands.register(baltop(), "Lists the richest players in a currency");
    commands.register(eco(), "Gives, takes or sets a player's money");
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
                                    Money.crystals(getLong(context, AMOUNT))))))
        .build();
  }

  private LiteralCommandNode<CommandSourceStack> baltop() {
    return Commands.literal("baltop")
        .executes(context -> baltop(context.getSource().getSender(), CurrencyId.CRYSTALS))
        .then(
            currencyArgument()
                .executes(
                    context ->
                        withCurrency(
                            context,
                            currency -> baltop(context.getSource().getSender(), currency))))
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
    return Commands.argument(PLAYER, word()).suggests((context, builder) -> suggest(builder));
  }

  private RequiredArgumentBuilder<CommandSourceStack, String> currencyArgument() {
    return Commands.argument(CURRENCY, word())
        .suggests((context, builder) -> suggestCurrencies(builder));
  }

  private RequiredArgumentBuilder<CommandSourceStack, String> adminAction(
      long minimum, AdminAction action) {
    RequiredArgumentBuilder<CommandSourceStack, Long> amount =
        Commands.argument(AMOUNT, longArg(minimum, MAX_AMOUNT))
            .executes(context -> runAdmin(context, CurrencyId.CRYSTALS, action))
            .then(
                currencyArgument()
                    .executes(
                        context ->
                            withCurrency(
                                context, currency -> runAdmin(context, currency, action))));
    return playerArgument().then(amount);
  }

  private int runAdmin(
      CommandContext<CommandSourceStack> context, CurrencyId currency, AdminAction action) {
    var sender = context.getSource().getSender();
    var amount = Money.of(currency, getLong(context, AMOUNT));
    withPlayer(sender, getString(context, PLAYER), target -> action.run(sender, target, amount));
    return Command.SINGLE_SUCCESS;
  }

  /** Runs {@code action} with the typed currency, or tells the sender which currencies exist. */
  private int withCurrency(
      CommandContext<CommandSourceStack> context, ToIntFunction<CurrencyId> action) {
    var typed = getString(context, CURRENCY);
    Optional<CurrencyId> currency = CurrencyId.parse(typed);
    if (currency.isEmpty()) {
      context
          .getSource()
          .getSender()
          .sendMessage(
              Replies.error(
                  "There is no currency called "
                      + typed
                      + ". Use one of: "
                      + currencyKeys()
                      + "."));
      return Command.SINGLE_SUCCESS;
    }
    return action.applyAsInt(currency.orElseThrow());
  }

  private static String currencyKeys() {
    return Arrays.stream(CurrencyId.values())
        .map(CurrencyId::key)
        .collect(Collectors.joining(", "));
  }

  /** Suggests online player names starting with what has been typed, ignoring case. */
  private CompletableFuture<Suggestions> suggest(SuggestionsBuilder builder) {
    var prefix = builder.getRemainingLowerCase();
    for (var player : paper.server().getOnlinePlayers()) {
      if (player.getName().toLowerCase(Locale.ROOT).startsWith(prefix)) {
        builder.suggest(player.getName());
      }
    }
    return builder.buildFuture();
  }

  private static CompletableFuture<Suggestions> suggestCurrencies(SuggestionsBuilder builder) {
    var prefix = builder.getRemainingLowerCase();
    for (var currency : CurrencyId.values()) {
      if (currency.key().startsWith(prefix)) {
        builder.suggest(currency.key());
      }
    }
    return builder.buildFuture();
  }

  private int ownBalance(CommandSender sender) {
    if (!(sender instanceof Player player)) {
      sender.sendMessage(Replies.error("Name a player: /balance <player>"));
      return Command.SINGLE_SUCCESS;
    }
    paper
        .replies()
        .whenDone(
            wallets.balances(new AccountId.Player(player.getUniqueId())),
            sender,
            balances -> {
              sender.sendMessage(Replies.info("Balance: " + listed(balances)));
              paper
                  .analytics()
                  .interaction(player.getUniqueId(), ProductAnalytics.Action.BALANCE_VIEWED);
            });
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
                    wallets.balances(target.account()),
                    sender,
                    balances -> {
                      sender.sendMessage(
                          Replies.info(target.name() + " has " + listed(balances) + "."));
                      if (sender instanceof Player player)
                        paper
                            .analytics()
                            .interaction(
                                player.getUniqueId(), ProductAnalytics.Action.BALANCE_VIEWED);
                    }));
    return Command.SINGLE_SUCCESS;
  }

  /** Every currency in {@link CurrencyId} order: "500 crystals, 3 Credits". */
  private String listed(Map<CurrencyId, Money> balances) {
    return Arrays.stream(CurrencyId.values())
        .map(currency -> format.words(Objects.requireNonNull(balances.get(currency))))
        .collect(Collectors.joining(", "));
  }

  private int pay(CommandSender sender, String name, Money amount) {
    if (!(sender instanceof Player payer)) {
      sender.sendMessage(Replies.error("Only players can pay; use /eco give instead."));
      return Command.SINGLE_SUCCESS;
    }
    var payerName = payer.getName();
    var payerAccount = new AccountId.Player(payer.getUniqueId());
    withPlayer(
        sender,
        name,
        target ->
            whenTransferred(
                sender,
                wallets.transfer(payerAccount, target.account(), amount, "pay"),
                receipt -> {
                  var words = format.words(receipt.amount());
                  sender.sendMessage(
                      Replies.success("You paid " + target.name() + " " + words + "."));
                  tell(target, Replies.success(payerName + " paid you " + words + "."));
                  paper
                      .analytics()
                      .interaction(payer.getUniqueId(), ProductAnalytics.Action.MONEY_TRANSFERRED);
                }));
    return Command.SINGLE_SUCCESS;
  }

  private int baltop(CommandSender sender, CurrencyId currency) {
    var names = format.currency(currency);
    paper
        .replies()
        .whenDone(
            wallets.leaderboard(currency, baltopSize),
            sender,
            ranked -> {
              if (ranked.isEmpty()) {
                sender.sendMessage(Replies.info("Nobody holds any " + names.plural() + " yet."));
                return;
              }
              sender.sendMessage(Replies.info("Most " + names.plural() + ":"));
              for (var index = 0; index < ranked.size(); index++) {
                sender.sendMessage(Replies.info(standingLine(index + 1, ranked.get(index))));
              }
            });
    return Command.SINGLE_SUCCESS;
  }

  private String standingLine(int rank, RankedPlayer player) {
    var name = player.name().orElseGet(() -> player.account().uuid().toString());
    return "#" + rank + " " + name + " " + format.symbol(player.balance());
  }

  private void give(CommandSender admin, SeenPlayer target, Money amount) {
    whenTransferred(
        admin,
        wallets.transfer(
            new AccountId.Server(), target.account(), amount, adminReason("give", admin)),
        receipt -> {
          var words = format.words(receipt.amount());
          admin.sendMessage(Replies.success("Gave " + target.name() + " " + words + "."));
          tell(target, Replies.success("An admin gave you " + words + "."));
        });
  }

  private void take(CommandSender admin, SeenPlayer target, Money amount) {
    whenTransferred(
        admin,
        wallets.transfer(
            target.account(), new AccountId.Server(), amount, adminReason("take", admin)),
        receipt -> {
          var words = format.words(receipt.amount());
          admin.sendMessage(Replies.success("Took " + words + " from " + target.name() + "."));
          tell(target, Replies.info("An admin took " + words + " from you."));
        });
  }

  private void set(CommandSender admin, SeenPlayer target, Money amount) {
    var plural = format.currency(amount.currency()).plural();
    paper
        .replies()
        .whenDone(
            wallets.setBalance(target.account(), amount, adminReason("set", admin)),
            admin,
            receipt -> {
              var words = format.words(amount);
              if (receipt.isEmpty()) {
                admin.sendMessage(Replies.info(target.name() + " already has " + words + "."));
                return;
              }
              admin.sendMessage(Replies.success("Set " + target.name() + " to " + words + "."));
              tell(
                  target,
                  Replies.info("An admin set your " + plural + " balance to " + words + "."));
            });
  }

  /** Finds {@code name} online, else in the shared directory, and runs {@code action} on them. */
  private void withPlayer(CommandSender sender, String name, Consumer<SeenPlayer> action) {
    Player online = paper.server().getPlayerExact(name);
    if (online != null) {
      action.accept(new SeenPlayer(online.getUniqueId(), online.getName()));
      return;
    }
    paper
        .replies()
        .whenDone(
            paper.players().byName(name),
            sender,
            found ->
                found.ifPresentOrElse(
                    known -> action.accept(new SeenPlayer(known.uuid(), known.lastName())),
                    () ->
                        sender.sendMessage(
                            Replies.error("Nobody named " + name + " has played on The Storm."))));
  }

  /** Sends {@code message} to {@code player} if they are online now. */
  private void tell(SeenPlayer player, Component message) {
    var online = paper.server().getPlayer(player.uuid());
    if (online != null) {
      online.sendMessage(message);
    }
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
    void run(CommandSender admin, SeenPlayer target, Money amount);
  }
}
