package com.shepherdjerred.thestorm.creative.adapter.paper;

import static com.mojang.brigadier.arguments.StringArgumentType.getString;
import static com.mojang.brigadier.arguments.StringArgumentType.greedyString;
import static com.mojang.brigadier.arguments.StringArgumentType.string;
import static com.mojang.brigadier.arguments.StringArgumentType.word;
import static io.papermc.paper.command.brigadier.Commands.argument;
import static io.papermc.paper.command.brigadier.Commands.literal;

import com.mojang.brigadier.Command;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import com.mojang.brigadier.context.CommandContext;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.players.Humans;
import com.shepherdjerred.thestorm.core.text.HouseStyle;
import com.shepherdjerred.thestorm.creative.adapter.export.SchematicFiles;
import com.shepherdjerred.thestorm.creative.adapter.worldedit.PlotSchematics;
import com.shepherdjerred.thestorm.creative.app.ClaimBook;
import com.shepherdjerred.thestorm.creative.app.ClaimStore;
import com.shepherdjerred.thestorm.creative.app.ReviewBook;
import com.shepherdjerred.thestorm.creative.app.ReviewStore;
import com.shepherdjerred.thestorm.creative.domain.CatalogDrift;
import com.shepherdjerred.thestorm.creative.domain.ClaimRefusal;
import com.shepherdjerred.thestorm.creative.domain.ClaimRequest;
import com.shepherdjerred.thestorm.creative.domain.ClaimRules;
import com.shepherdjerred.thestorm.creative.domain.CreativeConfig;
import com.shepherdjerred.thestorm.creative.domain.CreativePermissions;
import com.shepherdjerred.thestorm.creative.domain.DownloadNames;
import com.shepherdjerred.thestorm.creative.domain.EditDecision;
import com.shepherdjerred.thestorm.creative.domain.PlotFlag;
import com.shepherdjerred.thestorm.creative.domain.PlotFootprint;
import com.shepherdjerred.thestorm.creative.domain.PlotGrid;
import com.shepherdjerred.thestorm.creative.domain.PlotId;
import com.shepherdjerred.thestorm.creative.domain.PlotRole;
import com.shepherdjerred.thestorm.creative.domain.PlotSurface;
import com.shepherdjerred.thestorm.creative.domain.PlotView;
import com.shepherdjerred.thestorm.creative.domain.StoredClaim;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.entity.Player;
import org.jspecify.annotations.Nullable;

/**
 * Plot commands under {@code /creative}. {@code /plot} stays the survival shop rental. Nothing here
 * writes the historical catalog.
 */
public final class CreativePlots {

  private static final String LABEL = "Creative";
  private static final int NAME_LIMIT = 32;
  private static final int DESCRIPTION_LIMIT = 140;

  private final ModuleContext context;
  private final ClaimBook book;
  private final ClaimStore store;
  private final CreativeConfig config;
  private final World world;
  private final Runnable redraw;
  private final SchematicFiles schematics;
  private final PlotGrid grid;
  private final CreativeSurfaceCommands choices;
  private final CreativeMaintenanceCommands maintenance;
  private final CreativeMergeCommands merges;
  private final CreativeSchematicCommands library;
  private final CreativeReviewCommands reviews;
  private final PlotTeleport mover;

  /** What the plot commands need. Redraw runs on the main thread after a claim changes. */
  public record Parts(
      ModuleContext context,
      ClaimBook book,
      ClaimStore store,
      CreativeConfig config,
      World world,
      Runnable redraw,
      SchematicFiles schematics,
      PlotFootprint.States template,
      ReviewBook reviews,
      ReviewStore reviewStore) {}

  public CreativePlots(Parts parts) {
    this(parts, Player::teleportAsync);
  }

  CreativePlots(Parts parts, PlotTeleport.Arrival arrival) {
    this.context = parts.context();
    this.book = parts.book();
    this.store = parts.store();
    this.config = parts.config();
    this.world = parts.world();
    this.redraw = parts.redraw();
    this.schematics = parts.schematics();
    this.grid = config.grid();
    this.mover = new PlotTeleport(context, world, grid, arrival);
    this.choices = new CreativeSurfaceCommands(this::ready, this::owned, this::persist);
    this.maintenance =
        new CreativeMaintenanceCommands(
            new CreativeMaintenanceCommands.Hooks(
                grid,
                world,
                this::ready,
                this::owned,
                this::persist,
                this::removeClaim,
                this::linked,
                book::cluster,
                this::persistAll));
    this.merges =
        new CreativeMergeCommands(
            new CreativeMergeCommands.Hooks(
                grid,
                world,
                parts.template(),
                this::ready,
                this::owned,
                book::view,
                this::claimRow,
                book::merged,
                book::cluster,
                this::persistAll));
    this.library =
        new CreativeSchematicCommands(
            new CreativeSchematicCommands.Hooks(
                context, grid, world, schematics, this::ready, this::owned));
    this.reviews =
        new CreativeReviewCommands(
            new CreativeReviewCommands.Hooks(
                context,
                config,
                book,
                parts.reviews(),
                parts.reviewStore(),
                this::ready,
                this::standing,
                book::view,
                this::claimRow));
  }

  public void attach(LiteralArgumentBuilder<CommandSourceStack> root) {
    root.then(literal("claim").executes(this::claim));
    root.then(literal("auto").executes(this::auto));
    root.then(
        literal("home")
            .executes(this::homeHere)
            .then(argument("plot", greedyString()).executes(this::homePlot)));
    root.then(literal("tp").then(argument("plot", greedyString()).executes(this::visit)));
    root.then(literal("member").then(argument("player", word()).executes(this::member)));
    root.then(literal("unmember").then(argument("player", word()).executes(this::unmember)));
    root.then(literal("trust").then(argument("player", word()).executes(this::trust)));
    root.then(literal("untrust").then(argument("player", word()).executes(this::untrust)));
    root.then(literal("deny").then(argument("player", word()).executes(this::deny)));
    root.then(literal("undeny").then(argument("player", word()).executes(this::undeny)));
    root.then(
        literal("flag")
            .then(argument("name", string()).then(argument("value", word()).executes(this::flag))));
    root.then(literal("info").executes(this::info));
    root.then(literal("list").executes(this::list));
    root.then(literal("name").then(argument("name", greedyString()).executes(this::name)));
    root.then(
        literal("desc").then(argument("description", greedyString()).executes(this::describe)));
    root.then(literal("floor").then(argument("name", word()).executes(choices::floor)));
    root.then(literal("wall").then(argument("name", word()).executes(choices::wall)));
    root.then(literal("biome").then(argument("name", word()).executes(choices::biome)));
    root.then(
        literal("clear")
            .executes(maintenance::clearHint)
            .then(literal("confirm").executes(maintenance::clear)));
    root.then(literal("reset").executes(maintenance::reset));
    root.then(literal("unclaim").executes(maintenance::unclaim));
    root.then(literal("merge").then(argument("plot", greedyString()).executes(merges::merge)));
    root.then(literal("unlink").executes(merges::unlink));
    root.then(literal("save").then(argument("name", word()).executes(library::save)));
    root.then(literal("load").executes(library::load));
    root.then(literal("paste").then(argument("name", word()).executes(library::paste)));
    root.then(literal("rate").then(argument("score", word()).executes(reviews::rate)));
    root.then(
        literal("comment")
            .then(literal("delete").executes(reviews::delete))
            .then(argument("text", greedyString()).executes(reviews::comment)));
    root.then(literal("download").executes(this::download));
    root.then(
        literal("admin")
            .requires(source -> source.getSender().hasPermission(CreativePermissions.ADMIN))
            .then(literal("assign").then(argument("player", word()).executes(this::assign)))
            .then(literal("unclaim").executes(this::unclaim))
            .then(literal("scan").executes(this::scan)));
  }

  private int claim(CommandContext<CommandSourceStack> context) {
    var player = player(context);
    if (ready(player)) {
      claimCell(player, standing(player));
    }
    return Command.SINGLE_SUCCESS;
  }

  private int auto(CommandContext<CommandSourceStack> context) {
    var player = player(context);
    if (!ready(player)) {
      return Command.SINGLE_SUCCESS;
    }
    var at = feet(player);
    var found =
        ClaimRules.nearest(
            new ClaimRules.Area(
                grid,
                config.borderCenterX(),
                config.borderCenterZ(),
                config.borderSize(),
                this::free),
            at.getBlockX(),
            at.getBlockZ());
    if (found.isEmpty()) {
      error(player, "No free plot inside the border.");
      return Command.SINGLE_SUCCESS;
    }
    claimCell(player, found);
    return Command.SINGLE_SUCCESS;
  }

  private int homeHere(CommandContext<CommandSourceStack> context) {
    var player = player(context);
    if (!ready(player)) {
      return Command.SINGLE_SUCCESS;
    }
    var here = standing(player);
    if (here.isPresent() && canVisit(player, here.orElseThrow())) {
      teleport(player, here.orElseThrow());
      return Command.SINGLE_SUCCESS;
    }
    for (var view : book.visible()) {
      if (canVisit(player, view.id())) {
        teleport(player, view.id());
        return Command.SINGLE_SUCCESS;
      }
    }
    error(player, "You have no accessible plot inside the world border.");
    return Command.SINGLE_SUCCESS;
  }

  private int homePlot(CommandContext<CommandSourceStack> context) {
    var player = player(context);
    if (!ready(player)) {
      return Command.SINGLE_SUCCESS;
    }
    var id = plotId(player, getString(context, "plot").strip());
    if (id.isPresent() && !inside(id.orElseThrow())) {
      error(player, "That plot is outside the world border. Its build and ownership remain saved.");
    } else if (id.isPresent() && canVisit(player, id.orElseThrow())) {
      teleport(player, id.orElseThrow());
    } else if (id.isPresent()) {
      error(player, "You cannot visit that plot.");
    }
    return Command.SINGLE_SUCCESS;
  }

  private int visit(CommandContext<CommandSourceStack> context) {
    var player = player(context);
    if (!ready(player)) {
      return Command.SINGLE_SUCCESS;
    }
    var id = plotId(player, getString(context, "plot").strip());
    if (id.isPresent() && mayEnter(player, book.view(id.orElseThrow()))) {
      teleport(player, id.orElseThrow());
    } else if (id.isPresent()) {
      error(player, "You cannot visit that plot.");
    }
    return Command.SINGLE_SUCCESS;
  }

  private int member(CommandContext<CommandSourceStack> context) {
    return grant(context, PlotRole.MEMBER, true);
  }

  private int unmember(CommandContext<CommandSourceStack> context) {
    return grant(context, PlotRole.MEMBER, false);
  }

  private int trust(CommandContext<CommandSourceStack> context) {
    return grant(context, PlotRole.TRUSTED, true);
  }

  private int untrust(CommandContext<CommandSourceStack> context) {
    return grant(context, PlotRole.TRUSTED, false);
  }

  private int deny(CommandContext<CommandSourceStack> context) {
    return grant(context, PlotRole.DENIED, true);
  }

  private int undeny(CommandContext<CommandSourceStack> context) {
    return grant(context, PlotRole.DENIED, false);
  }

  private int flag(CommandContext<CommandSourceStack> context) {
    var player = player(context);
    if (!ready(player)) {
      return Command.SINGLE_SUCCESS;
    }
    var value = getString(context, "value");
    if (!value.equals("on") && !value.equals("off")) {
      error(player, "Use on or off.");
      return Command.SINGLE_SUCCESS;
    }
    var on = value.equals("on");
    var parsed = PlotFlag.parse(getString(context, "name"));
    if (parsed.isEmpty()) {
      error(player, "Unknown flag. Use pvp, use, vehicle, mob-interact, or explosion.");
      return Command.SINGLE_SUCCESS;
    }
    var flag = parsed.orElseThrow();
    var row = owned(player);
    if (row.isEmpty()) {
      error(player, "You do not own the plot you are standing on.");
      return Command.SINGLE_SUCCESS;
    }
    var current = row.orElseThrow();
    if (current.flags().contains(flag) == on) {
      error(player, flag.stored() + " is already " + (on ? "on" : "off") + ".");
      return Command.SINGLE_SUCCESS;
    }
    var next = new LinkedHashSet<>(current.flags());
    if (on) {
      next.add(flag);
    } else {
      next.remove(flag);
    }
    persistShared(
        player,
        current.withFlags(next),
        "Set " + flag.stored() + " " + (on ? "on" : "off") + " for " + current.id().text() + ".");
    return Command.SINGLE_SUCCESS;
  }

  private int grant(CommandContext<CommandSourceStack> context, PlotRole role, boolean add) {
    var player = player(context);
    if (ready(player)) {
      changeRole(player, online(player, getString(context, "player")), role, add);
    }
    return Command.SINGLE_SUCCESS;
  }

  private int info(CommandContext<CommandSourceStack> context) {
    var player = player(context);
    if (!ready(player)) {
      return Command.SINGLE_SUCCESS;
    }
    var at = standing(player);
    if (at.isEmpty()) {
      error(player, "You are standing on a road.");
      return Command.SINGLE_SUCCESS;
    }
    var id = at.orElseThrow();
    tell(player, describe(book.view(id)));
    for (var line : reviews.lines(id)) {
      tell(player, line);
    }
    return Command.SINGLE_SUCCESS;
  }

  private int list(CommandContext<CommandSourceStack> context) {
    var player = player(context);
    if (!ready(player)) {
      return Command.SINGLE_SUCCESS;
    }
    var any = false;
    for (var view : book.visible()) {
      if (canVisit(player, view.id())) {
        tell(player, view.id().text() + " " + view.name());
        any = true;
      }
    }
    if (!any) {
      error(player, "You have no accessible plots inside the world border.");
    }
    return Command.SINGLE_SUCCESS;
  }

  private int name(CommandContext<CommandSourceStack> context) {
    var player = player(context);
    if (ready(player)) {
      rename(player, getString(context, "name"), true);
    }
    return Command.SINGLE_SUCCESS;
  }

  private int describe(CommandContext<CommandSourceStack> context) {
    var player = player(context);
    if (ready(player)) {
      rename(player, getString(context, "description"), false);
    }
    return Command.SINGLE_SUCCESS;
  }

  private int download(CommandContext<CommandSourceStack> context) {
    var player = player(context);
    if (ready(player)) {
      copy(player);
    }
    return Command.SINGLE_SUCCESS;
  }

  private int assign(CommandContext<CommandSourceStack> context) {
    var player = player(context);
    if (ready(player)) {
      assignTo(player, online(player, getString(context, "player")));
    }
    return Command.SINGLE_SUCCESS;
  }

  private int unclaim(CommandContext<CommandSourceStack> context) {
    var player = player(context);
    if (ready(player)) {
      release(player);
    }
    return Command.SINGLE_SUCCESS;
  }

  private int scan(CommandContext<CommandSourceStack> context) {
    var player = player(context);
    if (!ready(player)) {
      return Command.SINGLE_SUCCESS;
    }
    var lines = CatalogDrift.report(book.catalog(), book.stored());
    if (lines.isEmpty()) {
      success(player, "No catalog drift.");
      return Command.SINGLE_SUCCESS;
    }
    for (var line : lines) {
      tell(player, line);
    }
    return Command.SINGLE_SUCCESS;
  }

  private void claimCell(Player player, Optional<PlotId> at) {
    var view = at.isPresent() ? book.view(at.orElseThrow()) : road();
    var inside =
        at.isPresent()
            && ClaimRules.inside(
                grid.bounds(at.orElseThrow()),
                config.borderCenterX(),
                config.borderCenterZ(),
                config.borderSize());
    var request =
        new ClaimRequest(
            player.getUniqueId(),
            staff(player),
            inside,
            at,
            view,
            ClaimRules.counted(player.getUniqueId(), book.visible()),
            config.claimCap());
    var refusal = ClaimRules.refusal(request);
    if (refusal.isPresent()) {
      error(player, message(refusal.orElseThrow()));
      return;
    }
    var id = at.orElseThrow();
    persist(
        player,
        new StoredClaim(
            id,
            Optional.of(player.getUniqueId()),
            false,
            true,
            view.name(),
            view.description(),
            Map.of(),
            Set.of(),
            PlotSurface.DEFAULT,
            Optional.empty()),
        new Notice("You claimed " + id.text() + ".", true));
  }

  private void changeRole(Player actor, @Nullable Player target, PlotRole role, boolean add) {
    if (target == null) {
      return;
    }
    var at = standing(actor);
    if (at.isEmpty()) {
      error(actor, "Stand on a plot to change who can use it.");
      return;
    }
    var id = at.orElseThrow();
    var view = book.view(id);
    if (view.owner().isEmpty()) {
      error(actor, "That plot has no owner.");
      return;
    }
    if (!mayGrant(actor, view, role)) {
      error(actor, "You cannot change that role.");
      return;
    }
    if (target.getUniqueId().equals(view.owner().orElseThrow())) {
      error(actor, "That player owns the plot.");
      return;
    }
    if (target.getUniqueId().equals(actor.getUniqueId())) {
      error(actor, "You cannot change your own role.");
      return;
    }
    var row = claimHere(id, view);
    var members = new LinkedHashMap<>(row.access());
    var current = members.get(target.getUniqueId());
    if (add) {
      if (current == role) {
        error(actor, "That player is already " + roleName(role) + ".");
        return;
      }
      if (!owner(actor, view) && current != null) {
        error(actor, "Only the owner can change that role.");
        return;
      }
      members.put(target.getUniqueId(), role);
    } else if (current != role) {
      error(actor, "That player is not " + roleName(role) + ".");
      return;
    } else {
      members.remove(target.getUniqueId());
    }
    persistShared(actor, row.withAccess(members), roleMessage(add, role, target.getName(), id));
  }

  private static boolean owner(Player actor, PlotView view) {
    return view.owner().isPresent() && view.owner().orElseThrow().equals(actor.getUniqueId());
  }

  /** The owner manages every role. A trusted player may add or remove members only. */
  private static boolean mayGrant(Player actor, PlotView view, PlotRole role) {
    if (owner(actor, view)) {
      return true;
    }
    return view.access().get(actor.getUniqueId()) == PlotRole.TRUSTED && role == PlotRole.MEMBER;
  }

  private static String roleName(PlotRole role) {
    return switch (role) {
      case MEMBER -> "a member";
      case TRUSTED -> "trusted";
      case DENIED -> "denied";
    };
  }

  private static String roleMessage(boolean add, PlotRole role, String name, PlotId id) {
    var plot = id.text();
    if (!add) {
      return switch (role) {
        case MEMBER -> "Removed member " + name + " from " + plot + ".";
        case TRUSTED -> "Removed trust for " + name + " on " + plot + ".";
        case DENIED -> "Allowed " + name + " onto " + plot + ".";
      };
    }
    return switch (role) {
      case MEMBER -> "Added " + name + " as a member of " + plot + ".";
      case TRUSTED -> "Trusted " + name + " on " + plot + ".";
      case DENIED -> "Denied " + name + " on " + plot + ".";
    };
  }

  /** The stored row, or a new one that keeps the catalog owner when the plot was only restored. */
  private StoredClaim claimHere(PlotId id, PlotView view) {
    var existing = book.row(id);
    if (existing.isPresent() && !existing.orElseThrow().released()) {
      return existing.orElseThrow();
    }
    var owner = view.countsTowardCap() ? view.owner() : Optional.<UUID>empty();
    return new StoredClaim(
        id,
        owner,
        false,
        view.countsTowardCap(),
        view.name(),
        view.description(),
        view.access(),
        view.flags(),
        view.surface(),
        Optional.empty());
  }

  private StoredClaim claimRow(PlotId id) {
    return claimHere(id, book.view(id));
  }

  private boolean linked(PlotId id) {
    return book.merged(id).size() > 1;
  }

  private void rename(Player player, String text, boolean name) {
    if (!ClaimRules.textFits(text, name ? NAME_LIMIT : DESCRIPTION_LIMIT)) {
      error(
          player,
          name ? "Use a name up to 32 characters." : "Use a description up to 140 characters.");
      return;
    }
    var row = owned(player);
    if (row.isEmpty()) {
      error(player, "You do not own the plot you are standing on.");
      return;
    }
    var current = row.orElseThrow();
    var next =
        name
            ? current.withText(text, current.description())
            : current.withText(current.name(), text);
    persist(player, next, "Saved " + current.id().text() + ".");
  }

  private void copy(Player player) {
    var at = standing(player);
    if (at.isEmpty()) {
      error(player, "Stand on a plot to download it.");
      return;
    }
    var view = book.view(at.orElseThrow());
    if (!canUseClaim(player, view)) {
      error(player, "You cannot download that plot.");
      return;
    }
    if (player.getServer().getPluginManager().getPlugin("WorldEdit") == null) {
      error(player, "WorldEdit is not available.");
      return;
    }
    var id = at.orElseThrow();
    byte[] bytes;
    try {
      bytes =
          PlotSchematics.copy(
              new PlotSchematics.Span(
                  world, grid.bounds(id), world.getMinHeight(), world.getMaxHeight() - 1));
    } catch (RuntimeException failure) {
      context.logger().error("Creative download failed for {}", id.text(), failure);
      error(player, "That plot could not be copied.");
      return;
    }
    var file = DownloadNames.file(id);
    var saved =
        schematics
            .write(file, bytes)
            .whenCompleteAsync(
                (ignored, failure) -> savedFile(player, file, failure),
                context.scheduler().mainThread());
    var _ = saved;
  }

  private void savedFile(Player player, String file, @Nullable Throwable failure) {
    if (failure != null) {
      context.logger().error("Creative schematic was not written: {}", file, failure);
      if (player.isOnline()) {
        error(player, "That plot could not be saved.");
      }
      return;
    }
    if (player.isOnline()) {
      success(player, "Saved " + file + " for you to fetch outside the world. It is not mailed.");
    }
  }

  private void assignTo(Player actor, @Nullable Player target) {
    if (target == null) {
      return;
    }
    var at = standing(actor);
    if (at.isEmpty()) {
      error(actor, "Stand on a plot to assign it.");
      return;
    }
    var id = at.orElseThrow();
    if (linked(id)) {
      error(actor, "Unlink this plot before assigning it.");
      return;
    }
    if (!inside(id)) {
      error(actor, "That plot is outside the world border.");
      return;
    }
    var view = book.view(id);
    persist(
        actor,
        new StoredClaim(
            id,
            Optional.of(target.getUniqueId()),
            false,
            false,
            view.name(),
            view.description(),
            view.access(),
            view.flags(),
            view.surface(),
            Optional.empty()),
        "Assigned " + id.text() + " to " + target.getName() + ".");
  }

  private void release(Player actor) {
    var at = standing(actor);
    if (at.isEmpty()) {
      error(actor, "Stand on a plot to unclaim it.");
      return;
    }
    var id = at.orElseThrow();
    if (linked(id)) {
      error(actor, "Unlink this plot before unclaiming it.");
      return;
    }
    if (book.catalog().get(id).isPresent()) {
      persist(
          actor,
          new StoredClaim(
              id,
              Optional.empty(),
              true,
              false,
              "",
              "",
              Map.of(),
              Set.of(),
              PlotSurface.DEFAULT,
              Optional.empty()),
          "Released " + id.text() + ".");
      return;
    }
    if (book.row(id).isEmpty()) {
      error(actor, "That plot is not claimed.");
      return;
    }
    removeClaim(actor, id, "Released " + id.text() + ".");
  }

  private void removeClaim(Player actor, PlotId id, String ok) {
    var removal = new Removal(actor, id, book.row(id), ok);
    book.remove(id);
    redraw.run();
    var saved =
        store
            .delete(id)
            .whenCompleteAsync(
                (ignored, failure) -> removed(removal, failure), context.scheduler().mainThread());
    var _ = saved;
  }

  private record Removal(Player actor, PlotId id, Optional<StoredClaim> previous, String ok) {}

  private void removed(Removal removal, @Nullable Throwable failure) {
    if (failure != null) {
      restore(removal.id(), removal.previous());
      context.logger().error("Creative unclaim failed for {}", removal.id().text(), failure);
      if (removal.actor().isOnline()) {
        error(removal.actor(), "That could not be saved.");
      }
      return;
    }
    if (removal.actor().isOnline()) {
      success(removal.actor(), removal.ok());
    }
  }

  /** Chat for a saved claim, and whether that save should then take the player home. */
  private record Notice(String ok, boolean teleportHome) {}

  /** One optimistic write of several merged rows. */
  private record SavedBatch(
      Player player, List<StoredClaim> claims, List<Optional<StoredClaim>> previous, String ok) {}

  /** One optimistic claim write and what to tell the player when it lands. */
  private record PendingSave(
      Player player, StoredClaim claim, Optional<StoredClaim> previous, Notice notice) {}

  private void persistShared(Player player, StoredClaim standing, String ok) {
    var rows = book.cluster(standing.id());
    if (rows.size() < 2) {
      persist(player, standing, ok);
      return;
    }
    var next = new ArrayList<StoredClaim>();
    var seen = false;
    for (var row : rows) {
      if (row.id().equals(standing.id())) {
        next.add(standing);
        seen = true;
      } else {
        next.add(row.withAccess(standing.access()).withFlags(standing.flags()));
      }
    }
    if (!seen) {
      next.add(standing);
    }
    persistAll(player, next, ok);
  }

  private void persistAll(Player player, List<StoredClaim> claims, String ok) {
    var previous = new ArrayList<Optional<StoredClaim>>();
    for (var claim : claims) {
      previous.add(book.row(claim.id()));
      book.put(claim);
    }
    redraw.run();
    var batch = new SavedBatch(player, List.copyOf(claims), List.copyOf(previous), ok);
    var saved =
        store
            .saveAll(claims)
            .whenCompleteAsync(
                (ignored, failure) -> persistedAll(batch, failure),
                context.scheduler().mainThread());
    var _ = saved;
  }

  private void persistedAll(SavedBatch batch, @Nullable Throwable failure) {
    if (failure != null) {
      for (int i = 0; i < batch.claims().size(); i++) {
        restore(batch.claims().get(i).id(), batch.previous().get(i));
      }
      context.logger().error("Creative claim save failed", failure);
      if (batch.player().isOnline()) {
        error(batch.player(), "That could not be saved.");
      }
      return;
    }
    if (batch.player().isOnline()) {
      success(batch.player(), batch.ok());
    }
  }

  private void persist(Player player, StoredClaim claim, String ok) {
    persist(player, claim, new Notice(ok, false));
  }

  private void persist(Player player, StoredClaim claim, Notice notice) {
    var pending = new PendingSave(player, claim, book.row(claim.id()), notice);
    book.put(claim);
    redraw.run();
    var saved =
        store
            .save(claim)
            .whenCompleteAsync(
                (ignored, failure) -> persisted(pending, failure),
                context.scheduler().mainThread());
    var _ = saved;
  }

  private void persisted(PendingSave pending, @Nullable Throwable failure) {
    if (failure != null) {
      restore(pending.claim().id(), pending.previous());
      context
          .logger()
          .error("Creative claim save failed for {}", pending.claim().id().text(), failure);
      if (pending.player().isOnline()) {
        error(pending.player(), "That could not be saved.");
      }
      return;
    }
    if (!pending.player().isOnline()) {
      return;
    }
    success(pending.player(), pending.notice().ok());
    if (pending.notice().teleportHome()) {
      teleport(pending.player(), pending.claim().id());
    }
  }

  private void restore(PlotId id, Optional<StoredClaim> previous) {
    if (previous.isPresent()) {
      book.put(previous.orElseThrow());
    } else {
      book.remove(id);
    }
    redraw.run();
  }

  private Optional<StoredClaim> owned(Player player) {
    var at = standing(player);
    if (at.isEmpty()) {
      return Optional.empty();
    }
    var view = book.view(at.orElseThrow());
    if (view.owner().isEmpty() || !view.owner().orElseThrow().equals(player.getUniqueId())) {
      return Optional.empty();
    }
    var existing = book.row(at.orElseThrow());
    if (existing.isPresent() && !existing.orElseThrow().released()) {
      return existing;
    }
    var owner = view.countsTowardCap() ? Optional.of(player.getUniqueId()) : Optional.<UUID>empty();
    return Optional.of(
        new StoredClaim(
            at.orElseThrow(),
            owner,
            false,
            view.countsTowardCap(),
            view.name(),
            view.description(),
            view.access(),
            view.flags(),
            view.surface(),
            Optional.empty()));
  }

  private boolean ready(Player player) {
    if (!Humans.isHuman(player)) {
      return false;
    }
    if (!book.ready()) {
      error(player, "Creative claims are still loading.");
      return false;
    }
    if (!world.getName().equals(player.getWorld().getName())) {
      error(player, "Enter creative before using that command.");
      return false;
    }
    return true;
  }

  private boolean canVisit(Player player, PlotId id) {
    return inside(id) && canUseClaim(player, book.view(id));
  }

  private boolean mayEnter(Player player, PlotView view) {
    return PlotRole.mayEnter(staff(player), view.access(), player.getUniqueId());
  }

  private boolean canUseClaim(Player player, PlotView view) {
    if (!view.marked()) {
      return false;
    }
    if (staff(player)) {
      return true;
    }
    return EditDecision.mayEdit(player.getUniqueId(), view.owner(), view.access());
  }

  private boolean free(PlotId id) {
    var view = book.view(id);
    return view.owner().isEmpty() && !view.staffHeld();
  }

  private boolean inside(PlotId id) {
    return ClaimRules.inside(
        grid.bounds(id), config.borderCenterX(), config.borderCenterZ(), config.borderSize());
  }

  private Optional<PlotId> standing(Player player) {
    var at = feet(player);
    return grid.plotAt(at.getBlockX(), at.getBlockZ());
  }

  private static Location feet(Player player) {
    var at = player.getLocation();
    if (at == null) {
      throw new IllegalStateException("Player has no location");
    }
    return at;
  }

  private Optional<PlotId> plotId(Player player, String text) {
    var id = PlotId.parse(text);
    if (id.isEmpty()) {
      error(player, "Use a plot id like 2;1.");
    }
    return id;
  }

  private @Nullable Player online(Player actor, String name) {
    var target = actor.getServer().getPlayerExact(name);
    if (target == null || !Humans.isHuman(target)) {
      error(actor, "That player is not online.");
      return null;
    }
    return target;
  }

  private void teleport(Player player, PlotId id) {
    mover.teleport(player, id);
  }

  private static boolean staff(Player player) {
    return player.hasPermission(CreativePermissions.BYPASS)
        || player.hasPermission(CreativePermissions.ADMIN);
  }

  private static PlotView road() {
    return new PlotView(
        new PlotId(0, 0),
        Optional.empty(),
        "",
        "",
        Map.of(),
        false,
        false,
        Set.of(),
        PlotSurface.DEFAULT);
  }

  private static String describe(PlotView view) {
    var owner = view.staffHeld() ? "staff" : view.owner().map(UUID::toString).orElse("nobody");
    return view.id().text() + " owner " + owner + " " + view.name() + " " + view.description();
  }

  private static String message(ClaimRefusal refusal) {
    return switch (refusal) {
      case ROAD -> "Stand on a plot to claim it.";
      case OUTSIDE -> "That plot is outside the world border.";
      case ALREADY -> "You already own that plot.";
      case OWNED -> "Someone else owns that plot.";
      case STAFF_HELD -> "Staff hold that plot.";
      case CAP -> "You have reached the claim cap.";
    };
  }

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
