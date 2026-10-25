package com.shepherdjerred.thestorm.creative.adapter.paper;

import static com.mojang.brigadier.arguments.StringArgumentType.getString;

import com.mojang.brigadier.Command;
import com.mojang.brigadier.context.CommandContext;
import com.shepherdjerred.thestorm.core.text.HouseStyle;
import com.shepherdjerred.thestorm.creative.domain.PlotFootprint;
import com.shepherdjerred.thestorm.creative.domain.PlotGrid;
import com.shepherdjerred.thestorm.creative.domain.PlotId;
import com.shepherdjerred.thestorm.creative.domain.PlotMerge;
import com.shepherdjerred.thestorm.creative.domain.PlotRoads;
import com.shepherdjerred.thestorm.creative.domain.PlotView;
import com.shepherdjerred.thestorm.creative.domain.StoredClaim;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.function.Predicate;
import net.kyori.adventure.text.Component;
import org.bukkit.Bukkit;
import org.bukkit.World;
import org.bukkit.block.data.BlockData;
import org.bukkit.entity.Player;

/** Owner commands that join orthogonally adjacent plots and separate them again. */
final class CreativeMergeCommands {

  private static final String LABEL = "Creative";

  @FunctionalInterface
  interface SaveAll {
    void save(Player player, List<StoredClaim> claims, String message);
  }

  record Hooks(
      PlotGrid grid,
      World world,
      PlotFootprint.States template,
      Predicate<Player> ready,
      Function<Player, Optional<StoredClaim>> owned,
      Function<PlotId, PlotView> view,
      Function<PlotId, StoredClaim> claimHere,
      Function<PlotId, List<PlotId>> merged,
      Function<PlotId, List<StoredClaim>> cluster,
      SaveAll save) {}

  private final Hooks hooks;

  CreativeMergeCommands(Hooks hooks) {
    this.hooks = hooks;
  }

  int merge(CommandContext<CommandSourceStack> context) {
    var row = owned(context);
    if (row.isEmpty()) {
      return Command.SINGLE_SUCCESS;
    }
    var standing = row.orElseThrow();
    var target = PlotId.parse(getString(context, "plot").strip());
    if (target.isEmpty()) {
      error(standing.player(), "Use a plot id like 2;1.");
      return Command.SINGLE_SUCCESS;
    }
    var planned = plan(standing, target.orElseThrow());
    if (planned.isPresent()) {
      var id = standing.claim().id();
      hooks
          .save()
          .save(
              standing.player(),
              planned.orElseThrow(),
              "Merged " + id.text() + " with " + target.orElseThrow().text() + ".");
    }
    return Command.SINGLE_SUCCESS;
  }

  int unlink(CommandContext<CommandSourceStack> context) {
    var row = owned(context);
    if (row.isEmpty()) {
      return Command.SINGLE_SUCCESS;
    }
    var standing = row.orElseThrow();
    var claim = standing.claim();
    var rows = hooks.cluster().apply(claim.id());
    if (rows.size() < 2) {
      error(standing.player(), "This plot is not merged.");
      return Command.SINGLE_SUCCESS;
    }
    if (!roadsMatch(rows)) {
      error(standing.player(), "The road between these plots does not match the template.");
      return Command.SINGLE_SUCCESS;
    }
    var next = new ArrayList<StoredClaim>();
    for (var member : rows) {
      next.add(
          member.withAccess(claim.access()).withFlags(claim.flags()).withCluster(Optional.empty()));
    }
    hooks.save().save(standing.player(), next, "Unlinked " + claim.id().text() + ".");
    return Command.SINGLE_SUCCESS;
  }

  private Optional<List<StoredClaim>> plan(Standing standing, PlotId target) {
    var claim = standing.claim();
    var player = standing.player();
    if (claim.id().equals(target)) {
      error(player, "That plot does not touch this one.");
      return Optional.empty();
    }
    var left = hooks.merged().apply(claim.id());
    var right = hooks.merged().apply(target);
    if (same(left, right)) {
      error(player, "That plot is already merged.");
      return Optional.empty();
    }
    if (!PlotMerge.touches(left, right)) {
      error(player, "That plot does not touch this one.");
      return Optional.empty();
    }
    var owner = hooks.view().apply(target).owner();
    if (owner.isEmpty()) {
      error(player, "That plot is not claimed.");
      return Optional.empty();
    }
    if (!owner.orElseThrow().equals(player.getUniqueId())) {
      error(player, "You do not own both plots.");
      return Optional.empty();
    }
    var union = union(left, right);
    if (!ownsAll(player, union)) {
      error(player, "You do not own both plots.");
      return Optional.empty();
    }
    return Optional.of(copy(claim, union));
  }

  private boolean ownsAll(Player player, List<PlotId> ids) {
    for (var id : ids) {
      var owner = hooks.view().apply(id).owner();
      if (owner.isEmpty() || !owner.orElseThrow().equals(player.getUniqueId())) {
        return false;
      }
    }
    return true;
  }

  private List<StoredClaim> copy(StoredClaim standing, List<PlotId> union) {
    var anchor = Optional.of(PlotMerge.anchor(union));
    var rows = new ArrayList<StoredClaim>();
    for (var id : union) {
      var row = id.equals(standing.id()) ? standing : hooks.claimHere().apply(id);
      rows.add(row.withAccess(standing.access()).withFlags(standing.flags()).withCluster(anchor));
    }
    return List.copyOf(rows);
  }

  private boolean roadsMatch(List<StoredClaim> rows) {
    var ids = new ArrayList<PlotId>();
    for (var row : rows) {
      ids.add(row.id());
    }
    var band =
        new PlotFootprint.Band(hooks.world().getMinHeight(), hooks.world().getMaxHeight() - 1);
    var cache = new HashMap<String, BlockData>();
    for (var road : PlotMerge.roads(hooks.grid(), ids)) {
      if (!PlotRoads.matches(road, band, (x, y, z) -> actual(cache, x, y, z), hooks.template())) {
        return false;
      }
    }
    return true;
  }

  private String actual(Map<String, BlockData> cache, int x, int y, int z) {
    var expected = hooks.template().at(x, y, z);
    var data = cache.computeIfAbsent(expected, Bukkit::createBlockData);
    var block = hooks.world().getBlockAt(x, y, z).getBlockData();
    return data.matches(block) ? expected : block.getAsString();
  }

  private static List<PlotId> union(List<PlotId> left, List<PlotId> right) {
    var ids = new ArrayList<>(left);
    for (var id : right) {
      if (!ids.contains(id)) {
        ids.add(id);
      }
    }
    return List.copyOf(ids);
  }

  private static boolean same(List<PlotId> left, List<PlotId> right) {
    return left.size() == right.size() && left.containsAll(right);
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

  private static void error(Player player, String text) {
    player.sendMessage(HouseStyle.error(LABEL, Component.text(text)));
  }
}
