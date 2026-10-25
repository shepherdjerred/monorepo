package com.shepherdjerred.thestorm.creative.adapter.paper;

import com.mojang.brigadier.Command;
import com.mojang.brigadier.context.CommandContext;
import com.shepherdjerred.thestorm.core.text.HouseStyle;
import com.shepherdjerred.thestorm.creative.domain.PlotGrid;
import com.shepherdjerred.thestorm.creative.domain.PlotId;
import com.shepherdjerred.thestorm.creative.domain.PlotSurface;
import com.shepherdjerred.thestorm.creative.domain.StoredClaim;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import java.util.Optional;
import java.util.Set;
import java.util.function.Function;
import java.util.function.Predicate;
import net.kyori.adventure.text.Component;
import org.bukkit.World;
import org.bukkit.entity.Player;

/**
 * Owner commands that restore a plot. Clear rewrites the footprint. Reset restores stored choices.
 * Unclaim removes a plot the player claimed, once that footprint matches the generator.
 */
final class CreativeMaintenanceCommands {

  private static final String LABEL = "Creative";

  @FunctionalInterface
  interface Save {
    void persist(Player player, StoredClaim claim, String message);
  }

  @FunctionalInterface
  interface Removal {
    void remove(Player player, PlotId id, String message);
  }

  record Hooks(
      PlotGrid grid,
      World world,
      Predicate<Player> ready,
      Function<Player, Optional<StoredClaim>> owned,
      Save save,
      Removal remove) {}

  private final Hooks hooks;

  CreativeMaintenanceCommands(Hooks hooks) {
    this.hooks = hooks;
  }

  int clearHint(CommandContext<CommandSourceStack> context) {
    var row = owned(context);
    if (row.isPresent()) {
      error(row.orElseThrow().player(), "Run /creative clear confirm to restore this plot.");
    }
    return Command.SINGLE_SUCCESS;
  }

  int clear(CommandContext<CommandSourceStack> context) {
    var row = owned(context);
    if (row.isEmpty()) {
      return Command.SINGLE_SUCCESS;
    }
    var owned = row.orElseThrow();
    var claim = owned.claim();
    PlotRestore.write(
        hooks.world(), hooks.grid(), hooks.grid().bounds(claim.id()), claim.surface());
    success(owned.player(), "Cleared " + claim.id().text() + ".");
    return Command.SINGLE_SUCCESS;
  }

  int reset(CommandContext<CommandSourceStack> context) {
    var row = owned(context);
    if (row.isEmpty()) {
      return Command.SINGLE_SUCCESS;
    }
    var owned = row.orElseThrow();
    var claim = owned.claim();
    if (claim.flags().isEmpty() && claim.surface().equals(PlotSurface.DEFAULT)) {
      error(owned.player(), claim.id().text() + " is already using the defaults.");
      return Command.SINGLE_SUCCESS;
    }
    hooks
        .save()
        .persist(
            owned.player(),
            claim.withFlags(Set.of()).withSurface(PlotSurface.DEFAULT),
            "Reset " + claim.id().text() + ".");
    return Command.SINGLE_SUCCESS;
  }

  int unclaim(CommandContext<CommandSourceStack> context) {
    var row = owned(context);
    if (row.isEmpty()) {
      return Command.SINGLE_SUCCESS;
    }
    var owned = row.orElseThrow();
    var claim = owned.claim();
    if (!claim.countsTowardCap()) {
      error(owned.player(), "Only a plot you claimed yourself can be unclaimed.");
      return Command.SINGLE_SUCCESS;
    }
    if (!PlotRestore.matchesTemplate(
        hooks.world(), hooks.grid(), hooks.grid().bounds(claim.id()))) {
      error(owned.player(), "This plot does not match the template.");
      return Command.SINGLE_SUCCESS;
    }
    hooks.remove().remove(owned.player(), claim.id(), "Unclaimed " + claim.id().text() + ".");
    return Command.SINGLE_SUCCESS;
  }

  private Optional<Standing> owned(CommandContext<CommandSourceStack> context) {
    var player = player(context);
    if (!hooks.ready().test(player)) {
      return Optional.empty();
    }
    var claim = hooks.owned().apply(player);
    if (claim.isEmpty()) {
      error(player, "You do not own the plot you are standing on.");
      return Optional.empty();
    }
    return Optional.of(new Standing(player, claim.orElseThrow()));
  }

  private record Standing(Player player, StoredClaim claim) {}

  private static Player player(CommandContext<CommandSourceStack> context) {
    return (Player) context.getSource().getSender();
  }

  private static void success(Player player, String text) {
    player.sendMessage(HouseStyle.success(LABEL, Component.text(text)));
  }

  private static void error(Player player, String text) {
    player.sendMessage(HouseStyle.error(LABEL, Component.text(text)));
  }
}
