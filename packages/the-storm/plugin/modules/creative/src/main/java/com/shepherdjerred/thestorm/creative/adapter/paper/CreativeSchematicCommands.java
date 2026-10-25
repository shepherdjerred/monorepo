package com.shepherdjerred.thestorm.creative.adapter.paper;

import static com.mojang.brigadier.arguments.StringArgumentType.getString;

import com.mojang.brigadier.Command;
import com.mojang.brigadier.context.CommandContext;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.text.HouseStyle;
import com.shepherdjerred.thestorm.creative.adapter.export.SchematicFiles;
import com.shepherdjerred.thestorm.creative.adapter.worldedit.PlotSchematics;
import com.shepherdjerred.thestorm.creative.domain.PlotGrid;
import com.shepherdjerred.thestorm.creative.domain.SchematicNames;
import com.shepherdjerred.thestorm.creative.domain.StoredClaim;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import java.util.List;
import java.util.Optional;
import java.util.function.Function;
import java.util.function.Predicate;
import net.kyori.adventure.text.Component;
import org.bukkit.World;
import org.bukkit.entity.Player;
import org.jspecify.annotations.Nullable;

/** A player's own plot schematics. Download stays the staff-fetchable copy. */
final class CreativeSchematicCommands {

  private static final String LABEL = "Creative";

  record Hooks(
      ModuleContext context,
      PlotGrid grid,
      World world,
      SchematicFiles files,
      Predicate<Player> ready,
      Function<Player, Optional<StoredClaim>> owned) {}

  private final Hooks hooks;

  CreativeSchematicCommands(Hooks hooks) {
    this.hooks = hooks;
  }

  int save(CommandContext<CommandSourceStack> context) {
    var row = owned(context);
    if (row.isEmpty()) {
      return Command.SINGLE_SUCCESS;
    }
    var standing = row.orElseThrow();
    var name = relative(standing.player(), getString(context, "name"));
    if (name.isEmpty() || !worldEdit(standing.player())) {
      return Command.SINGLE_SUCCESS;
    }
    byte[] bytes;
    try {
      bytes = PlotSchematics.copy(span(standing.claim()));
    } catch (RuntimeException failure) {
      hooks.context().logger().error("Creative schematic save failed", failure);
      error(standing.player(), "That plot could not be copied.");
      return Command.SINGLE_SUCCESS;
    }
    var file = name.orElseThrow();
    var saved =
        hooks
            .files()
            .write(file, bytes)
            .whenCompleteAsync(
                (ignored, failure) -> saved(standing.player(), label(file), failure),
                hooks.context().scheduler().mainThread());
    var _ = saved;
    return Command.SINGLE_SUCCESS;
  }

  int load(CommandContext<CommandSourceStack> context) {
    var player = player(context);
    if (!hooks.ready().test(player)) {
      return Command.SINGLE_SUCCESS;
    }
    var listed =
        hooks
            .files()
            .list(player.getUniqueId())
            .whenCompleteAsync(
                (names, failure) -> listed(player, names, failure),
                hooks.context().scheduler().mainThread());
    var _ = listed;
    return Command.SINGLE_SUCCESS;
  }

  int paste(CommandContext<CommandSourceStack> context) {
    var row = owned(context);
    if (row.isEmpty()) {
      return Command.SINGLE_SUCCESS;
    }
    var standing = row.orElseThrow();
    var name = relative(standing.player(), getString(context, "name"));
    if (name.isEmpty()) {
      return Command.SINGLE_SUCCESS;
    }
    var bounds = hooks.grid().bounds(standing.claim().id());
    if (!PlotRestore.matchesTemplate(hooks.world(), hooks.grid(), bounds)) {
      error(standing.player(), "This plot does not match the template.");
      return Command.SINGLE_SUCCESS;
    }
    if (!worldEdit(standing.player())) {
      return Command.SINGLE_SUCCESS;
    }
    var file = name.orElseThrow();
    var read =
        hooks
            .files()
            .read(file)
            .whenCompleteAsync(
                (bytes, failure) ->
                    paste(standing, file, bytes == null ? null : new Read(bytes), failure),
                hooks.context().scheduler().mainThread());
    var _ = read;
    return Command.SINGLE_SUCCESS;
  }

  private void paste(
      Standing standing, String file, @Nullable Read read, @Nullable Throwable failure) {
    var player = standing.player();
    if (!player.isOnline()) {
      return;
    }
    if (failure != null || read == null) {
      hooks.context().logger().error("Creative schematic was not read: {}", file, failure);
      error(player, "That schematic could not be pasted.");
      return;
    }
    if (read.bytes().isEmpty()) {
      error(player, "You have no schematic by that name.");
      return;
    }
    try {
      var problem = PlotSchematics.paste(span(standing.claim()), read.bytes().orElseThrow());
      if (problem.isPresent()) {
        error(player, problemMessage(problem.orElseThrow()));
        return;
      }
    } catch (RuntimeException pasteFailure) {
      hooks.context().logger().error("Creative schematic paste failed: {}", file, pasteFailure);
      error(player, "That schematic could not be pasted.");
      return;
    }
    success(player, "Pasted " + label(file) + " onto " + standing.claim().id().text() + ".");
  }

  private static String problemMessage(PlotSchematics.Problem problem) {
    return switch (problem) {
      case SIZE -> "That schematic is not one plot.";
      case BANNED -> "That schematic contains a banned block.";
    };
  }

  private void listed(Player player, @Nullable ListNames names, @Nullable Throwable failure) {
    if (!player.isOnline()) {
      return;
    }
    if (failure != null || names == null) {
      hooks.context().logger().error("Creative schematic list failed", failure);
      error(player, "Your schematics could not be listed.");
      return;
    }
    if (names.names().isEmpty()) {
      error(player, "You have no schematics.");
      return;
    }
    for (var name : names.names()) {
      tell(player, name);
    }
  }

  private void saved(Player player, String name, @Nullable Throwable failure) {
    if (failure != null) {
      hooks.context().logger().error("Creative schematic was not written: {}", name, failure);
      if (player.isOnline()) {
        error(player, "That schematic could not be saved.");
      }
      return;
    }
    if (player.isOnline()) {
      success(player, "Saved " + name + ".");
    }
  }

  /** Bridges a nullable list through the async callback without a raw list type. */
  private record ListNames(List<String> names) {}

  /** Bridges a nullable optional through the async callback. */
  private record Read(Optional<byte[]> bytes) {}

  private void listed(Player player, @Nullable List<String> names, @Nullable Throwable failure) {
    listed(player, names == null ? null : new ListNames(names), failure);
  }

  private PlotSchematics.Span span(StoredClaim claim) {
    return new PlotSchematics.Span(
        hooks.world(),
        hooks.grid().bounds(claim.id()),
        hooks.world().getMinHeight(),
        hooks.world().getMaxHeight() - 1);
  }

  private Optional<String> relative(Player player, String name) {
    var file = SchematicNames.relative(player.getUniqueId(), name);
    if (file.isEmpty()) {
      error(player, "Use a name of letters, numbers, _ or - up to 32 characters.");
    }
    return file;
  }

  private boolean worldEdit(Player player) {
    if (player.getServer().getPluginManager().getPlugin("WorldEdit") == null) {
      error(player, "WorldEdit is not available.");
      return false;
    }
    return true;
  }

  private static String label(String file) {
    var slash = file.lastIndexOf('/');
    var name = slash < 0 ? file : file.substring(slash + 1);
    if (name.endsWith(".schem")) {
      return name.substring(0, name.length() - ".schem".length());
    }
    return name;
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

  private static void tell(Player player, String text) {
    player.sendMessage(HouseStyle.info(LABEL, Component.text(text)));
  }

  private static void success(Player player, String text) {
    player.sendMessage(HouseStyle.success(LABEL, Component.text(text)));
  }

  private static void error(Player player, String text) {
    player.sendMessage(HouseStyle.error(LABEL, Component.text(text)));
  }
}
