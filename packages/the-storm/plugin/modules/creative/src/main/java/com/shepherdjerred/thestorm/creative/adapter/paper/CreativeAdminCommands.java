package com.shepherdjerred.thestorm.creative.adapter.paper;

import static com.mojang.brigadier.arguments.StringArgumentType.getString;

import com.mojang.brigadier.Command;
import com.mojang.brigadier.context.CommandContext;
import com.shepherdjerred.thestorm.core.text.HouseStyle;
import com.shepherdjerred.thestorm.creative.adapter.worldedit.PlotSchematics;
import com.shepherdjerred.thestorm.creative.domain.PlotGrid;
import com.shepherdjerred.thestorm.creative.domain.PlotId;
import com.shepherdjerred.thestorm.creative.domain.PlotSurface;
import com.shepherdjerred.thestorm.creative.domain.PlotTemplate;
import com.shepherdjerred.thestorm.creative.domain.PlotView;
import com.shepherdjerred.thestorm.creative.domain.StoredClaim;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.function.BooleanSupplier;
import java.util.function.Function;
import java.util.function.Predicate;
import net.kyori.adventure.text.Component;
import org.bukkit.World;
import org.bukkit.command.CommandSender;

/**
 * Console-safe staff commands. Unclaim releases a plot by id and redraws its marker. Clear writes
 * the empty spawn footprint first, then does that release. Move copies one unmerged footprint onto
 * an empty cell and leaves the spawn footprint behind.
 */
final class CreativeAdminCommands {

  private static final String LABEL = "Creative";

  @FunctionalInterface
  interface Save {
    void persist(CommandSender sender, StoredClaim claim, String message);
  }

  @FunctionalInterface
  interface SaveAll {
    void save(CommandSender sender, List<StoredClaim> claims, String message);
  }

  @FunctionalInterface
  interface Removal {
    void remove(CommandSender sender, PlotId id, String message);
  }

  record Hooks(
      PlotGrid grid,
      World world,
      PlotTemplate empty,
      BooleanSupplier ready,
      Predicate<PlotId> inside,
      Predicate<PlotId> linked,
      Function<PlotId, PlotView> view,
      Predicate<PlotId> catalog,
      Save save,
      SaveAll saveAll,
      Removal remove) {}

  private final Hooks hooks;

  CreativeAdminCommands(Hooks hooks) {
    this.hooks = hooks;
  }

  int unclaim(CommandContext<CommandSourceStack> context) {
    var sender = sender(context);
    var id = claimed(sender, argument(context, "plot"));
    if (id.isPresent()) {
      release(sender, id.orElseThrow(), "Released " + id.orElseThrow().text() + ".");
    }
    return Command.SINGLE_SUCCESS;
  }

  int clearHint(CommandContext<CommandSourceStack> context) {
    var sender = sender(context);
    var id = plot(sender, argument(context, "plot"));
    if (id.isPresent()) {
      error(sender, "Run /creative admin clear confirm " + id.orElseThrow().text() + ".");
    }
    return Command.SINGLE_SUCCESS;
  }

  int clearConfirmed(CommandContext<CommandSourceStack> context) {
    var sender = sender(context);
    var id = claimed(sender, argument(context, "plot"));
    if (id.isEmpty()) {
      return Command.SINGLE_SUCCESS;
    }
    var plot = id.orElseThrow();
    EmptyPlot.write(hooks.world(), hooks.empty(), hooks.grid().bounds(plot));
    release(sender, plot, "Cleared and released " + plot.text() + ".");
    return Command.SINGLE_SUCCESS;
  }

  int move(CommandContext<CommandSourceStack> context) {
    var sender = sender(context);
    var parts = argument(context, "plots").split(" ", -1);
    if (parts.length != 2) {
      error(sender, "Use two plot ids, like 2;1 3;1.");
      return Command.SINGLE_SUCCESS;
    }
    var from = claimed(sender, parts[0]);
    if (from.isEmpty()) {
      return Command.SINGLE_SUCCESS;
    }
    var source = from.orElseThrow();
    var to = plot(sender, parts[1]);
    if (to.isEmpty()) {
      return Command.SINGLE_SUCCESS;
    }
    var destination = to.orElseThrow();
    if (!movable(sender, source, destination)) {
      return Command.SINGLE_SUCCESS;
    }
    var bytes =
        PlotSchematics.copy(
            new PlotSchematics.Span(
                hooks.world(),
                hooks.grid().bounds(source),
                hooks.world().getMinHeight(),
                hooks.world().getMaxHeight() - 1));
    var problem =
        PlotSchematics.paste(
            new PlotSchematics.Span(
                hooks.world(),
                hooks.grid().bounds(destination),
                hooks.world().getMinHeight(),
                hooks.world().getMaxHeight() - 1),
            bytes);
    if (problem.isPresent()) {
      error(sender, "That plot could not be copied.");
      return Command.SINGLE_SUCCESS;
    }
    EmptyPlot.write(hooks.world(), hooks.empty(), hooks.grid().bounds(source));
    hooks
        .saveAll()
        .save(
            sender,
            List.of(carried(hooks.view().apply(source), destination), released(source)),
            "Moved " + source.text() + " to " + destination.text() + ".");
    return Command.SINGLE_SUCCESS;
  }

  private boolean movable(CommandSender sender, PlotId source, PlotId destination) {
    if (source.equals(destination)) {
      error(sender, "Name two different plots.");
      return false;
    }
    if (!hooks.inside().test(destination)) {
      error(sender, "That plot is outside the world border.");
      return false;
    }
    if (hooks.view().apply(destination).marked()) {
      error(sender, "That plot is already claimed.");
      return false;
    }
    return true;
  }

  private Optional<PlotId> claimed(CommandSender sender, String text) {
    var id = plot(sender, text);
    if (id.isEmpty()) {
      return Optional.empty();
    }
    var plot = id.orElseThrow();
    if (!open(sender, plot)) {
      return Optional.empty();
    }
    if (!hooks.view().apply(plot).marked()) {
      error(sender, "That plot is not claimed.");
      return Optional.empty();
    }
    return Optional.of(plot);
  }

  private Optional<PlotId> plot(CommandSender sender, String text) {
    if (!ready(sender)) {
      return Optional.empty();
    }
    var id = PlotId.parse(text);
    if (id.isEmpty()) {
      error(sender, "Use a plot id like 2;1.");
    }
    return id;
  }

  private boolean ready(CommandSender sender) {
    if (hooks.ready().getAsBoolean()) {
      return true;
    }
    error(sender, "Creative claims are still loading.");
    return false;
  }

  private boolean open(CommandSender sender, PlotId id) {
    if (hooks.linked().test(id)) {
      error(sender, "Unlink this plot before changing it.");
      return false;
    }
    if (!hooks.inside().test(id)) {
      error(sender, "That plot is outside the world border.");
      return false;
    }
    return true;
  }

  private void release(CommandSender sender, PlotId id, String ok) {
    if (hooks.catalog().test(id)) {
      hooks.save().persist(sender, released(id), ok);
      return;
    }
    hooks.remove().remove(sender, id, ok);
  }

  private static StoredClaim released(PlotId id) {
    return new StoredClaim(
        id,
        Optional.empty(),
        true,
        false,
        "",
        "",
        Map.of(),
        Set.of(),
        PlotSurface.DEFAULT,
        Optional.empty(),
        false);
  }

  private static StoredClaim carried(PlotView view, PlotId to) {
    var staff = view.staffHeld();
    return new StoredClaim(
        to,
        staff ? Optional.empty() : view.owner(),
        false,
        !staff && view.countsTowardCap(),
        view.name(),
        view.description(),
        view.access(),
        view.flags(),
        view.surface(),
        Optional.empty(),
        staff);
  }

  private static CommandSender sender(CommandContext<CommandSourceStack> context) {
    return context.getSource().getSender();
  }

  private static String argument(CommandContext<CommandSourceStack> context, String name) {
    return getString(context, name);
  }

  private static void error(CommandSender sender, String text) {
    sender.sendMessage(HouseStyle.error(LABEL, Component.text(text)));
  }
}
