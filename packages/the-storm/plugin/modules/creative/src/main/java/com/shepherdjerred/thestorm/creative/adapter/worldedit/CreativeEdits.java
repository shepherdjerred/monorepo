package com.shepherdjerred.thestorm.creative.adapter.worldedit;

import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.creative.app.ClaimBook;
import com.shepherdjerred.thestorm.creative.domain.BlockBox;
import com.shepherdjerred.thestorm.creative.domain.CreativePermissions;
import com.shepherdjerred.thestorm.creative.domain.EditDecision;
import com.shepherdjerred.thestorm.creative.domain.PlotGrid;
import com.shepherdjerred.thestorm.creative.domain.PlotId;
import com.sk89q.worldedit.EditSession;
import com.sk89q.worldedit.IncompleteRegionException;
import com.sk89q.worldedit.LocalSession;
import com.sk89q.worldedit.WorldEdit;
import com.sk89q.worldedit.bukkit.BukkitAdapter;
import com.sk89q.worldedit.bukkit.BukkitPlayer;
import com.sk89q.worldedit.event.extent.EditSessionEvent;
import com.sk89q.worldedit.event.platform.CommandEvent;
import com.sk89q.worldedit.extension.platform.Actor;
import com.sk89q.worldedit.extent.Extent;
import com.sk89q.worldedit.regions.Region;
import com.sk89q.worldedit.util.SideEffect;
import com.sk89q.worldedit.util.SideEffectSet;
import com.sk89q.worldedit.util.eventbus.Subscribe;
import com.sk89q.worldedit.util.formatting.text.TextComponent;
import com.sk89q.worldedit.world.World;
import java.time.Duration;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerChangedWorldEvent;
import org.bukkit.event.player.PlayerCommandPreprocessEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.jspecify.annotations.Nullable;

/**
 * Bounds a creative WorldEdit to the plot the player is standing in. The mask is installed before
 * history, so a refused edit is not recorded. An agent or console session is left alone. Neighbor
 * updates are off and lighting stays on for these edits, and the player's previous side effects
 * return when they leave creative.
 */
public final class CreativeEdits implements Listener {

  private final ClaimBook book;
  private final PlotGrid grid;
  private final String worldName;
  private final int brushRadius;
  private final Scheduler scheduler;
  private final Set<UUID> busy = new HashSet<>();
  private final Set<UUID> fromCommand = new HashSet<>();
  private final Map<UUID, SideEffectSet> savedEffects = new HashMap<>();

  /** What an edit guard needs. The scheduler clears a lock if an edit never commits. */
  public record Parts(
      ClaimBook book, PlotGrid grid, String worldName, int brushRadius, Scheduler scheduler) {}

  public CreativeEdits(Parts parts) {
    this.book = parts.book();
    this.grid = parts.grid();
    this.worldName = parts.worldName();
    this.brushRadius = parts.brushRadius();
    this.scheduler = parts.scheduler();
  }

  public void register(org.bukkit.plugin.Plugin plugin) {
    WorldEdit.getInstance().getEventBus().register(this);
    plugin.getServer().getPluginManager().registerEvents(this, plugin);
  }

  public void unregister() {
    WorldEdit.getInstance().getEventBus().unregister(this);
    busy.clear();
  }

  /**
   * Stops a creative WorldEdit command before WorldEdit runs it. WorldEdit 7.4 runs the command
   * from its own {@link CommandEvent} subscriber and does not read {@code setCancelled}, so the
   * Bukkit preprocess event is what keeps a refused command from changing blocks.
   */
  @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
  public void beforeWorldEdit(PlayerCommandPreprocessEvent event) {
    var player = event.getPlayer();
    var actor = BukkitAdapter.adapt(player);
    if (!involved(actor, player) || !EditDecision.worldEditCommand(event.getMessage())) {
      return;
    }
    var reason = refusal(event.getMessage(), actor, player);
    if (reason == null) {
      return;
    }
    event.setCancelled(true);
    actor.printError(TextComponent.of(reason));
  }

  /** Side effects for a creative command that was allowed to run. */
  @Subscribe
  public void onCommand(CommandEvent event) {
    var actor = bukkitPlayer(event.getActor());
    if (actor == null) {
      return;
    }
    var player = actor.getPlayer();
    if (!involved(actor, player)) {
      return;
    }
    if (refusal(event.getArguments(), actor, player) != null) {
      return;
    }
    if (worldName.equals(player.getWorld().getName())) {
      limitSideEffects(actor);
    }
    var id = player.getUniqueId();
    fromCommand.add(id);
    scheduler.runOnMainThreadLater(Duration.ofMillis(1), () -> fromCommand.remove(id));
  }

  /**
   * Wraps the extent before history. CoreProtect records a later stage, so a throw here is not a
   * successful change.
   */
  @Subscribe
  public void onEdit(EditSessionEvent event) {
    if (event.getStage() != EditSession.Stage.BEFORE_HISTORY) {
      return;
    }
    var world = event.getWorld();
    if (world == null || !worldName.equals(world.getName())) {
      return;
    }
    var actor = bukkitPlayer(event.getActor());
    if (actor == null) {
      return;
    }
    event.setExtent(masked(event.getExtent(), world, actor));
  }

  @EventHandler
  public void changedWorld(PlayerChangedWorldEvent event) {
    if (!worldName.equals(event.getPlayer().getWorld().getName())) {
      release(event.getPlayer());
    }
  }

  @EventHandler
  public void quit(PlayerQuitEvent event) {
    release(event.getPlayer());
  }

  private boolean involved(BukkitPlayer actor, Player player) {
    if (worldName.equals(player.getWorld().getName())) {
      return true;
    }
    var selected = session(actor).getSelectionWorld();
    return selected != null && worldName.equals(selected.getName());
  }

  /**
   * Why this command is refused, or null when it may run. Selection commands stay available so the
   * player can shrink a selection that leaves the plot.
   */
  private @Nullable String refusal(String commandLine, BukkitPlayer actor, Player player) {
    if (EditDecision.blockedCommand(commandLine)) {
      return "That WorldEdit command is not available in creative.";
    }
    var radius = EditDecision.commandedBrushRadius(commandLine);
    if (radius.isPresent() && !EditDecision.brushFits(radius.getAsInt(), brushRadius)) {
      return "That brush is larger than the creative cap.";
    }
    if (busy.contains(player.getUniqueId())) {
      return "You already have an edit running.";
    }
    if (!worldName.equals(player.getWorld().getName())) {
      return "Enter creative before editing that world.";
    }
    if (EditDecision.editsWorld(commandLine) && selectionLeaves(actor, player)) {
      return "That selection leaves the plot.";
    }
    return null;
  }

  /**
   * The Bukkit player behind a WorldEdit actor. An edit session actor is a {@code PlayerProxy}, not
   * a {@link BukkitPlayer}, and still shares that player's session.
   */
  private static @Nullable BukkitPlayer bukkitPlayer(@Nullable Actor actor) {
    if (actor instanceof BukkitPlayer bukkit) {
      return bukkit;
    }
    if (!(actor instanceof com.sk89q.worldedit.entity.Player player)) {
      return null;
    }
    var online = player.getUniqueId();
    var found = org.bukkit.Bukkit.getPlayer(online);
    if (found == null) {
      return null;
    }
    return BukkitAdapter.adapt(found);
  }

  private Extent masked(Extent current, World world, BukkitPlayer actor) {
    var player = actor.getPlayer();
    var column = new PlotExtent.Column(Optional.empty(), world.getMinY(), world.getMaxY());
    if (!worldName.equals(player.getWorld().getName()) || heldBrushTooLarge(actor, player)) {
      return new PlotExtent(current, column, () -> {});
    }
    var id = player.getUniqueId();
    if (!busy.add(id)) {
      return new PlotExtent(current, column, () -> {});
    }
    var backup = scheduler.runOnMainThreadLater(Duration.ofMinutes(10), () -> busy.remove(id));
    var standing = standing(player);
    var allowed = player.hasPermission(CreativePermissions.BYPASS) || member(player, standing);
    var mask = EditDecision.mask(grid, standing, allowed);
    return new PlotExtent(
        current,
        new PlotExtent.Column(mask, world.getMinY(), world.getMaxY()),
        () -> {
          busy.remove(id);
          backup.cancel();
        });
  }

  private boolean heldBrushTooLarge(BukkitPlayer actor, Player player) {
    if (fromCommand.remove(player.getUniqueId())) {
      return false;
    }
    var material = player.getInventory().getItemInMainHand().getType();
    var item = BukkitAdapter.asItemType(material);
    if (item == null) {
      return false;
    }
    var brush = session(actor).getBrush(item);
    if (brush == null) {
      return false;
    }
    return !EditDecision.brushFits((int) Math.ceil(brush.getSize()), brushRadius);
  }

  private boolean member(Player player, Optional<PlotId> standing) {
    if (standing.isEmpty()) {
      return false;
    }
    var view = book.view(standing.orElseThrow());
    return EditDecision.mayEdit(player.getUniqueId(), view.owner(), view.trusted());
  }

  private boolean selectionLeaves(BukkitPlayer actor, Player player) {
    var local = session(actor);
    var selected = local.getSelectionWorld();
    if (selected == null || !worldName.equals(selected.getName())) {
      return false;
    }
    var region = region(local, selected);
    if (region == null) {
      return false;
    }
    var standing = standing(player);
    var allowed = player.hasPermission(CreativePermissions.BYPASS) || member(player, standing);
    var mask = EditDecision.mask(grid, standing, allowed);
    if (mask.isEmpty()) {
      return true;
    }
    var min = region.getMinimumPoint();
    var max = region.getMaximumPoint();
    var box = new BlockBox(min.x(), min.y(), min.z(), max.x(), max.y(), max.z());
    return !EditDecision.selectionFits(
        mask.orElseThrow(), box, selected.getMinY(), selected.getMaxY());
  }

  private void limitSideEffects(BukkitPlayer actor) {
    var local = session(actor);
    savedEffects.putIfAbsent(actor.getUniqueId(), local.getSideEffectSet());
    local.setSideEffectSet(
        local
            .getSideEffectSet()
            .with(SideEffect.NEIGHBORS, SideEffect.State.OFF)
            .with(SideEffect.LIGHTING, SideEffect.State.ON));
  }

  private void release(Player player) {
    busy.remove(player.getUniqueId());
    fromCommand.remove(player.getUniqueId());
    var saved = savedEffects.remove(player.getUniqueId());
    if (saved == null) {
      return;
    }
    session(BukkitAdapter.adapt(player)).setSideEffectSet(saved);
  }

  private Optional<PlotId> standing(Player player) {
    var at = player.getLocation();
    if (at == null) {
      return Optional.empty();
    }
    return grid.plotAt(at.getBlockX(), at.getBlockZ());
  }

  private static LocalSession session(BukkitPlayer actor) {
    return WorldEdit.getInstance().getSessionManager().get(actor);
  }

  private static @Nullable Region region(LocalSession local, World world) {
    try {
      return local.getSelection(world);
    } catch (IncompleteRegionException _) {
      return null;
    }
  }
}
