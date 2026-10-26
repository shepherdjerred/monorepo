package com.shepherdjerred.thestorm.creative.adapter.paper;

import static com.mojang.brigadier.arguments.StringArgumentType.getString;
import static com.mojang.brigadier.arguments.StringArgumentType.greedyString;
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
import com.shepherdjerred.thestorm.creative.domain.CatalogDrift;
import com.shepherdjerred.thestorm.creative.domain.ClaimRefusal;
import com.shepherdjerred.thestorm.creative.domain.ClaimRequest;
import com.shepherdjerred.thestorm.creative.domain.ClaimRules;
import com.shepherdjerred.thestorm.creative.domain.CreativeConfig;
import com.shepherdjerred.thestorm.creative.domain.CreativePermissions;
import com.shepherdjerred.thestorm.creative.domain.DownloadNames;
import com.shepherdjerred.thestorm.creative.domain.EditDecision;
import com.shepherdjerred.thestorm.creative.domain.PlotGrid;
import com.shepherdjerred.thestorm.creative.domain.PlotId;
import com.shepherdjerred.thestorm.creative.domain.PlotView;
import com.shepherdjerred.thestorm.creative.domain.StoredClaim;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import java.util.LinkedHashSet;
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

  /** What the plot commands need. Redraw runs on the main thread after a claim changes. */
  public record Parts(
      ModuleContext context,
      ClaimBook book,
      ClaimStore store,
      CreativeConfig config,
      World world,
      Runnable redraw,
      SchematicFiles schematics) {}

  public CreativePlots(Parts parts) {
    this.context = parts.context();
    this.book = parts.book();
    this.store = parts.store();
    this.config = parts.config();
    this.world = parts.world();
    this.redraw = parts.redraw();
    this.schematics = parts.schematics();
    this.grid = config.grid();
  }

  public void attach(LiteralArgumentBuilder<CommandSourceStack> root) {
    root.then(literal("claim").executes(this::claim));
    root.then(literal("auto").executes(this::auto));
    root.then(
        literal("home")
            .executes(this::homeHere)
            .then(argument("plot", greedyString()).executes(this::homePlot)));
    root.then(literal("trust").then(argument("player", word()).executes(this::trust)));
    root.then(literal("untrust").then(argument("player", word()).executes(this::untrust)));
    root.then(literal("info").executes(this::info));
    root.then(literal("list").executes(this::list));
    root.then(literal("name").then(argument("name", greedyString()).executes(this::name)));
    root.then(
        literal("desc").then(argument("description", greedyString()).executes(this::describe)));
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

  private int trust(CommandContext<CommandSourceStack> context) {
    var player = player(context);
    if (ready(player)) {
      changeTrust(player, online(player, getString(context, "player")), true);
    }
    return Command.SINGLE_SUCCESS;
  }

  private int untrust(CommandContext<CommandSourceStack> context) {
    var player = player(context);
    if (ready(player)) {
      changeTrust(player, online(player, getString(context, "player")), false);
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
    tell(player, describe(book.view(at.orElseThrow())));
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
            Set.of()),
        "You claimed " + id.text() + ".");
  }

  private void changeTrust(Player player, @Nullable Player target, boolean add) {
    if (target == null) {
      return;
    }
    var row = owned(player);
    if (row.isEmpty()) {
      error(player, "You do not own the plot you are standing on.");
      return;
    }
    if (target.getUniqueId().equals(player.getUniqueId())) {
      error(player, "You already own that plot.");
      return;
    }
    var members = new LinkedHashSet<>(row.orElseThrow().trusted());
    var changed = add ? members.add(target.getUniqueId()) : members.remove(target.getUniqueId());
    if (!changed) {
      error(player, add ? "That player is already trusted." : "That player is not trusted.");
      return;
    }
    var verb = add ? "Trusted " : "Untrusted ";
    persist(
        player,
        row.orElseThrow().withTrusted(members),
        verb + target.getName() + " on " + row.orElseThrow().id().text() + ".");
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
    if (!canCopy(player, view)) {
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
              world, grid.bounds(id), world.getMinHeight(), world.getMaxHeight() - 1);
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
            view.trusted()),
        "Assigned " + id.text() + " to " + target.getName() + ".");
  }

  private void release(Player actor) {
    var at = standing(actor);
    if (at.isEmpty()) {
      error(actor, "Stand on a plot to unclaim it.");
      return;
    }
    var id = at.orElseThrow();
    if (book.catalog().get(id).isPresent()) {
      persist(
          actor,
          new StoredClaim(id, Optional.empty(), true, false, "", "", Set.of()),
          "Released " + id.text() + ".");
      return;
    }
    if (book.row(id).isEmpty()) {
      error(actor, "That plot is not claimed.");
      return;
    }
    var previous = book.row(id);
    book.remove(id);
    redraw.run();
    var saved =
        store
            .delete(id)
            .whenCompleteAsync(
                (ignored, failure) -> deleted(actor, id, previous, failure),
                context.scheduler().mainThread());
    var _ = saved;
  }

  private void deleted(
      Player actor, PlotId id, Optional<StoredClaim> previous, @Nullable Throwable failure) {
    if (failure != null) {
      restore(id, previous);
      context.logger().error("Creative unclaim failed for {}", id.text(), failure);
      if (actor.isOnline()) {
        error(actor, "That could not be saved.");
      }
      return;
    }
    if (actor.isOnline()) {
      success(actor, "Released " + id.text() + ".");
    }
  }

  /** One optimistic claim write and the chat line to send when it lands. */
  private record PendingSave(
      Player player, StoredClaim claim, Optional<StoredClaim> previous, String ok) {}

  private void persist(Player player, StoredClaim claim, String ok) {
    var pending = new PendingSave(player, claim, book.row(claim.id()), ok);
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
    if (pending.player().isOnline()) {
      success(pending.player(), pending.ok());
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
            view.trusted()));
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
    if (!inside(id)) {
      return false;
    }
    var view = book.view(id);
    if (staff(player) && view.marked()) {
      return true;
    }
    return EditDecision.mayEdit(player.getUniqueId(), view.owner(), view.trusted());
  }

  private boolean canCopy(Player player, PlotView view) {
    if (!view.marked()) {
      return false;
    }
    if (staff(player)) {
      return true;
    }
    return EditDecision.mayEdit(player.getUniqueId(), view.owner(), view.trusted());
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
    var bounds = grid.bounds(id);
    var x = Math.floorDiv(bounds.minX() + bounds.maxX(), 2) + 0.5;
    var z = Math.floorDiv(bounds.minZ() + bounds.maxZ(), 2) + 0.5;
    var moved = player.teleport(new Location(world, x, PlotGrid.SPAWN_Y, z));
    if (moved) {
      success(player, "Teleported to " + id.text() + ".");
    } else {
      error(player, "Could not teleport to " + id.text() + ".");
    }
  }

  private static boolean staff(Player player) {
    return player.hasPermission(CreativePermissions.BYPASS)
        || player.hasPermission(CreativePermissions.ADMIN);
  }

  private static PlotView road() {
    return new PlotView(new PlotId(0, 0), Optional.empty(), "", "", Set.of(), false, false);
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
