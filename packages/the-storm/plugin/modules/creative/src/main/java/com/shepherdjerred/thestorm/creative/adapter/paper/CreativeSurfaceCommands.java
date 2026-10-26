package com.shepherdjerred.thestorm.creative.adapter.paper;

import static com.mojang.brigadier.arguments.StringArgumentType.getString;

import com.mojang.brigadier.Command;
import com.mojang.brigadier.context.CommandContext;
import com.shepherdjerred.thestorm.core.text.HouseStyle;
import com.shepherdjerred.thestorm.creative.domain.PlotSurface;
import com.shepherdjerred.thestorm.creative.domain.StoredClaim;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import java.util.Optional;
import java.util.function.Function;
import java.util.function.Predicate;
import net.kyori.adventure.text.Component;
import org.bukkit.entity.Player;

/** Owner commands that store a floor, wall, or biome. They do not rewrite blocks. */
final class CreativeSurfaceCommands {

  private static final String LABEL = "Creative";

  @FunctionalInterface
  interface Save {
    void persist(Player player, StoredClaim claim, String message);
  }

  private final Predicate<Player> ready;
  private final Function<Player, Optional<StoredClaim>> owned;
  private final Save save;

  CreativeSurfaceCommands(
      Predicate<Player> ready, Function<Player, Optional<StoredClaim>> owned, Save save) {
    this.ready = ready;
    this.owned = owned;
    this.save = save;
  }

  int floor(CommandContext<CommandSourceStack> context) {
    return choose(context, "floor");
  }

  int wall(CommandContext<CommandSourceStack> context) {
    return choose(context, "wall");
  }

  int biome(CommandContext<CommandSourceStack> context) {
    return choose(context, "biome");
  }

  private int choose(CommandContext<CommandSourceStack> context, String kind) {
    var player = player(context);
    if (!ready.test(player)) {
      return Command.SINGLE_SUCCESS;
    }
    var name = getString(context, "name");
    var choice = parse(kind, name);
    if (!choice.known()) {
      error(player, "Unknown " + kind + ". Use " + names(kind) + ".");
      return Command.SINGLE_SUCCESS;
    }
    var row = owned.apply(player);
    if (row.isEmpty()) {
      error(player, "You do not own the plot you are standing on.");
      return Command.SINGLE_SUCCESS;
    }
    var current = row.orElseThrow();
    var next = apply(kind, current.surface(), choice);
    if (current.surface().equals(next)) {
      error(player, "The " + kind + " is already " + name + ".");
      return Command.SINGLE_SUCCESS;
    }
    save.persist(
        player,
        current.withSurface(next),
        "Set the " + kind + " of " + current.id().text() + " to " + name + ".");
    return Command.SINGLE_SUCCESS;
  }

  private static PlotSurface.Choice parse(String kind, String name) {
    return switch (kind) {
      case "floor" -> PlotSurface.floor(name);
      case "wall" -> PlotSurface.wall(name);
      case "biome" -> PlotSurface.biome(name);
      default -> throw new IllegalArgumentException("unknown creative choice: " + kind);
    };
  }

  private static PlotSurface apply(String kind, PlotSurface current, PlotSurface.Choice choice) {
    return switch (kind) {
      case "floor" -> current.withFloor(choice.stored());
      case "wall" -> current.withWall(choice.stored());
      case "biome" -> current.withBiome(choice.stored());
      default -> throw new IllegalArgumentException("unknown creative choice: " + kind);
    };
  }

  private static String names(String kind) {
    return switch (kind) {
      case "floor" -> PlotSurface.floors();
      case "wall" -> PlotSurface.walls();
      case "biome" -> PlotSurface.biomes();
      default -> throw new IllegalArgumentException("unknown creative choice: " + kind);
    };
  }

  private static Player player(CommandContext<CommandSourceStack> context) {
    return (Player) context.getSource().getSender();
  }

  private static void error(Player player, String text) {
    player.sendMessage(HouseStyle.error(LABEL, Component.text(text)));
  }
}
