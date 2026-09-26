package com.shepherdjerred.thestorm.quests.adapter.paper;

import static com.mojang.brigadier.arguments.StringArgumentType.getString;
import static com.mojang.brigadier.arguments.StringArgumentType.word;

import com.mojang.brigadier.Command;
import com.mojang.brigadier.builder.ArgumentBuilder;
import com.mojang.brigadier.builder.RequiredArgumentBuilder;
import com.mojang.brigadier.context.CommandContext;
import com.mojang.brigadier.exceptions.CommandSyntaxException;
import com.mojang.brigadier.tree.LiteralCommandNode;
import com.shepherdjerred.thestorm.core.players.KnownPlayer;
import com.shepherdjerred.thestorm.core.players.PlayerDirectory;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.core.text.HouseStyle;
import com.shepherdjerred.thestorm.quests.app.QuestService;
import com.shepherdjerred.thestorm.quests.app.QuestStore;
import com.shepherdjerred.thestorm.quests.domain.view.Journal;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.command.brigadier.Commands;
import io.papermc.paper.command.brigadier.argument.ArgumentTypes;
import io.papermc.paper.command.brigadier.argument.resolvers.selector.PlayerSelectorArgumentResolver;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.function.BiConsumer;
import java.util.function.Function;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

/**
 * {@code /quests} (the journal), {@code /quests track|abandon <quest>}, {@code /quests top}, and
 * for administrators ({@value #ADMIN}) {@code /quests admin reset|complete <player> <quest>} and
 * {@code /quests admin stage <player> <quest> <stage>}. Administration works on online players.
 */
final class QuestCommands {

  static final String ADMIN = "thestorm.quests.admin";
  static final String LABEL = "Quests";
  private static final String QUEST = "quest";
  private static final String PLAYER = "player";
  private static final String STAGE = "stage";

  /**
   * What the commands drive.
   *
   * @param journal shows the journal to a player (a dialog on a real server)
   * @param players names for {@code /quests top}
   */
  record Wiring(
      QuestService service,
      BiConsumer<Player, Journal.View> journal,
      PlayerDirectory players,
      Executor mainThread,
      ComponentLogger logger) {}

  private final Wiring wiring;

  QuestCommands(Wiring wiring) {
    this.wiring = wiring;
  }

  void register(Commands commands) {
    commands.register(node(), "Your quest journal", List.of("q"));
  }

  LiteralCommandNode<CommandSourceStack> node() {
    return Commands.literal("quests")
        .executes(context -> journal(context.getSource().getSender()))
        .then(
            Commands.literal("track")
                .then(
                    activeQuest()
                        .executes(
                            context ->
                                track(context.getSource().getSender(), getString(context, QUEST)))))
        .then(
            Commands.literal("abandon")
                .then(
                    activeQuest()
                        .executes(
                            context ->
                                abandon(
                                    context.getSource().getSender(), getString(context, QUEST)))))
        .then(Commands.literal("top").executes(context -> top(context.getSource().getSender())))
        .then(admin())
        .build();
  }

  private ArgumentBuilder<CommandSourceStack, ?> admin() {
    return Commands.literal("admin")
        .requires(source -> source.getSender().hasPermission(ADMIN))
        .then(
            Commands.literal("reset")
                .then(
                    Commands.argument(PLAYER, ArgumentTypes.player())
                        .then(
                            anyQuest()
                                .executes(
                                    context ->
                                        admin(
                                            context,
                                            target ->
                                                wiring
                                                    .service()
                                                    .adminReset(
                                                        target, getString(context, QUEST)))))))
        .then(
            Commands.literal("complete")
                .then(
                    Commands.argument(PLAYER, ArgumentTypes.player())
                        .then(
                            anyQuest()
                                .executes(
                                    context ->
                                        admin(
                                            context,
                                            target ->
                                                wiring
                                                    .service()
                                                    .adminComplete(
                                                        target, getString(context, QUEST)))))))
        .then(
            Commands.literal("stage")
                .then(
                    Commands.argument(PLAYER, ArgumentTypes.player())
                        .then(
                            anyQuest()
                                .then(
                                    Commands.argument(STAGE, word())
                                        .executes(
                                            context ->
                                                admin(
                                                    context,
                                                    target ->
                                                        wiring
                                                            .service()
                                                            .adminStage(
                                                                target,
                                                                getString(context, QUEST),
                                                                getString(context, STAGE))))))));
  }

  private RequiredArgumentBuilder<CommandSourceStack, String> activeQuest() {
    return Commands.argument(QUEST, word())
        .suggests(
            (context, builder) -> {
              if (context.getSource().getSender() instanceof Player player) {
                var prefix = builder.getRemainingLowerCase();
                wiring
                    .service()
                    .state(player.getUniqueId())
                    .ifPresent(
                        state ->
                            state.active().keySet().stream()
                                .filter(id -> id.startsWith(prefix))
                                .forEach(builder::suggest));
              }
              return builder.buildFuture();
            });
  }

  private RequiredArgumentBuilder<CommandSourceStack, String> anyQuest() {
    return Commands.argument(QUEST, word())
        .suggests(
            (context, builder) -> {
              var prefix = builder.getRemainingLowerCase();
              wiring.service().content().quests().keySet().stream()
                  .filter(id -> id.startsWith(prefix))
                  .sorted()
                  .forEach(builder::suggest);
              return builder.buildFuture();
            });
  }

  private int journal(CommandSender sender) {
    if (!(sender instanceof Player player)) {
      sender.sendMessage(error("Only players have a quest journal."));
      return Command.SINGLE_SUCCESS;
    }
    var view = wiring.service().journal(player.getUniqueId());
    if (view.isEmpty()) {
      sender.sendMessage(error("Your quests are still loading."));
    } else {
      wiring.journal().accept(player, view.get());
    }
    return Command.SINGLE_SUCCESS;
  }

  private int track(CommandSender sender, String quest) {
    if (sender instanceof Player player) {
      wiring.service().track(player.getUniqueId(), quest);
    } else {
      sender.sendMessage(error("Only players track quests."));
    }
    return Command.SINGLE_SUCCESS;
  }

  private int abandon(CommandSender sender, String quest) {
    if (sender instanceof Player player) {
      wiring.service().abandon(player.getUniqueId(), quest);
    } else {
      sender.sendMessage(error("Only players have quests."));
    }
    return Command.SINGLE_SUCCESS;
  }

  private int top(CommandSender sender) {
    var _ =
        wiring
            .service()
            .top()
            .thenCompose(this::named)
            .whenCompleteAsync(
                (lines, failure) -> {
                  if (failure != null) {
                    wiring.logger().error("/quests top failed", failure);
                    sender.sendMessage(error("The quest rankings are unavailable right now."));
                    return;
                  }
                  sender.sendMessage(info("Most quest points:"));
                  if (lines.isEmpty()) {
                    sender.sendMessage(Component.text(" Nobody yet.", NamedTextColor.GRAY));
                  }
                  lines.forEach(
                      line -> sender.sendMessage(Component.text(line, NamedTextColor.GRAY)));
                },
                wiring.mainThread());
    return Command.SINGLE_SUCCESS;
  }

  /** "1. Name: 12" lines, looking names up in order. */
  private CompletableFuture<List<String>> named(List<QuestStore.Standing> standings) {
    CompletableFuture<List<String>> lines = CompletableFuture.completedFuture(List.of());
    for (var standing : standings) {
      lines =
          lines.thenCombine(
              wiring.players().byId(standing.player()),
              (sofar, known) -> {
                var name = known.map(KnownPlayer::lastName).orElseGet(standing.player()::toString);
                var next = new ArrayList<>(sofar);
                next.add(" " + (sofar.size() + 1) + ". " + name + ": " + standing.points());
                return List.copyOf(next);
              });
    }
    return lines;
  }

  private int admin(
      CommandContext<CommandSourceStack> context, Function<UUID, Result<String, String>> action)
      throws CommandSyntaxException {
    var sender = context.getSource().getSender();
    var targets =
        context
            .getArgument(PLAYER, PlayerSelectorArgumentResolver.class)
            .resolve(context.getSource());
    for (var target : targets) {
      switch (action.apply(target.getUniqueId())) {
        case Result.Ok<String, String>(var message) ->
            sender.sendMessage(success(message + " for " + target.getName() + "."));
        case Result.Err<String, String>(var message) -> sender.sendMessage(error(message));
      }
    }
    return Command.SINGLE_SUCCESS;
  }

  private static Component info(String message) {
    return HouseStyle.info(LABEL, Component.text(message));
  }

  private static Component success(String message) {
    return HouseStyle.success(LABEL, Component.text(message));
  }

  private static Component error(String message) {
    return HouseStyle.error(LABEL, Component.text(message));
  }
}
