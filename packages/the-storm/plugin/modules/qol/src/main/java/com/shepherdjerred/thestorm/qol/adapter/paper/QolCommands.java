package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.mojang.brigadier.Command;
import com.mojang.brigadier.context.CommandContext;
import com.shepherdjerred.thestorm.qol.app.GraveRegistry;
import com.shepherdjerred.thestorm.qol.domain.grave.GravePolicy;
import com.shepherdjerred.thestorm.qol.domain.grave.GravePolicy.Status;
import com.shepherdjerred.thestorm.qol.domain.text.DurationText;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.command.brigadier.Commands;
import java.util.function.Consumer;
import org.bukkit.entity.Player;

/** {@code /graves} and {@code /sort}. */
final class QolCommands {

  private final QolRuntime runtime;
  private final GraveRegistry graves;
  private final GravePolicy policy;
  private final ContainerSorting sorting;

  QolCommands(
      QolRuntime runtime, GraveRegistry graves, GravePolicy policy, ContainerSorting sorting) {
    this.runtime = runtime;
    this.graves = graves;
    this.policy = policy;
    this.sorting = sorting;
  }

  void register(Commands commands) {
    commands.register(
        Commands.literal("graves")
            .requires(source -> source.getSender().hasPermission(QolPermissions.GRAVES))
            .executes(context -> asPlayer(context, this::listGraves))
            .build(),
        "List your graves and where they are");
    commands.register(
        Commands.literal("sort")
            .requires(source -> source.getSender().hasPermission(QolPermissions.SORT))
            .executes(context -> asPlayer(context, sorting::sortLookedAt))
            .build(),
        "Sort the chest, barrel or shulker box you are looking at");
  }

  private void listGraves(Player player) {
    if (!graves.isLoaded()) {
      Say.error(player, Say.GRAVES, "Graves are still loading; try again in a moment.");
      return;
    }
    var owned = graves.ownedBy(player.getUniqueId());
    if (owned.isEmpty()) {
      Say.info(player, Say.GRAVES, "You have no graves.");
      return;
    }
    Say.info(player, Say.GRAVES, "Your graves:");
    var now = runtime.time().instant();
    var number = 1;
    for (var grave : owned) {
      var state =
          switch (policy.status(grave, now)) {
            case Status.Locked(var remaining) ->
                "only you can open it for " + DurationText.of(remaining);
            case Status.Open(var remaining) ->
                "anyone can open it; it breaks open in " + DurationText.of(remaining);
            case Status.Expired() -> "it breaks open when someone is next nearby";
          };
      Say.info(player, Say.GRAVES, number + ". " + grave.pos().describe() + ": " + state);
      number++;
    }
  }

  private static int asPlayer(CommandContext<CommandSourceStack> context, Consumer<Player> action) {
    if (context.getSource().getSender() instanceof Player player) {
      action.accept(player);
      return Command.SINGLE_SUCCESS;
    }
    Say.error(context.getSource().getSender(), Say.STORM, "Only players can do that.");
    return 0;
  }
}
