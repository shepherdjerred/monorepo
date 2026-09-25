package com.shepherdjerred.thestorm.qol.adapter.paper;

import static com.mojang.brigadier.arguments.StringArgumentType.getString;
import static com.mojang.brigadier.arguments.StringArgumentType.word;

import com.mojang.brigadier.Command;
import com.mojang.brigadier.context.CommandContext;
import com.mojang.brigadier.suggestion.Suggestions;
import com.mojang.brigadier.suggestion.SuggestionsBuilder;
import com.shepherdjerred.thestorm.qol.domain.QolConfig;
import com.shepherdjerred.thestorm.world.app.WildWorlds;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.command.brigadier.Commands;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import org.bukkit.entity.Player;

/** {@code /rtp}, {@code /rtp <biome>}, {@code /rtp <world>} and {@code /rtp <world> <biome>}. */
final class RtpCommands {

  private final RtpFlow flow;
  private final WildWorlds worlds;
  private final QolConfig config;

  RtpCommands(RtpFlow flow, WildWorlds worlds, QolConfig config) {
    this.flow = flow;
    this.worlds = worlds;
    this.config = config;
  }

  void register(Commands commands) {
    var biome = Commands.argument("biome", word()).suggests(this::biomes);
    commands.register(
        Commands.literal("rtp")
            .executes(this::plain)
            .then(
                Commands.argument("target", word())
                    .suggests(this::targets)
                    .executes(this::one)
                    .then(biome.executes(this::two)))
            .build(),
        "Teleport far from claims");
  }

  private int plain(CommandContext<CommandSourceStack> context) {
    return asPlayer(
        context, player -> flow.start(player, worlds.defaultWorld().name(), Optional.empty()));
  }

  private int one(CommandContext<CommandSourceStack> context) {
    var target = getString(context, "target");
    return asPlayer(context, player -> one(player, target));
  }

  private void one(Player player, String target) {
    if (isWorld(target)) {
      flow.start(player, target, Optional.empty());
      return;
    }
    flow.start(player, worlds.defaultWorld().name(), Optional.of(target));
  }

  private int two(CommandContext<CommandSourceStack> context) {
    var world = getString(context, "target");
    var biome = getString(context, "biome");
    return asPlayer(context, player -> flow.start(player, world, Optional.of(biome)));
  }

  private boolean isWorld(String name) {
    var world = worlds.named(name);
    return world.isPresent() && world.get().rtp();
  }

  private CompletableFuture<Suggestions> targets(
      CommandContext<CommandSourceStack> context, SuggestionsBuilder builder) {
    for (var world : worlds.worlds()) {
      if (world.rtp()) {
        builder.suggest(world.name());
      }
    }
    for (var biome : config.biomes()) {
      builder.suggest(biome);
    }
    return builder.buildFuture();
  }

  private CompletableFuture<Suggestions> biomes(
      CommandContext<CommandSourceStack> context, SuggestionsBuilder builder) {
    for (var biome : config.biomes()) {
      builder.suggest(biome);
    }
    return builder.buildFuture();
  }

  private static int asPlayer(
      CommandContext<CommandSourceStack> context, java.util.function.Consumer<Player> action) {
    if (context.getSource().getSender() instanceof Player player) {
      action.accept(player);
    } else {
      context.getSource().getSender().sendMessage(Messages.error("Only players can do that."));
    }
    return Command.SINGLE_SUCCESS;
  }
}
