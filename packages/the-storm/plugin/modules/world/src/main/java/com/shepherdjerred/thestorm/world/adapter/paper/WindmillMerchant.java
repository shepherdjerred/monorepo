package com.shepherdjerred.thestorm.world.adapter.paper;

import static java.util.Objects.requireNonNull;

import com.shepherdjerred.thestorm.world.app.MerchantGate;
import com.shepherdjerred.thestorm.world.domain.MerchantAnchor;
import com.shepherdjerred.thestorm.world.domain.MerchantConfig;
import com.shepherdjerred.thestorm.world.domain.MerchantStock;
import java.time.Duration;
import java.time.Instant;
import java.time.InstantSource;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Executor;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.World;
import org.bukkit.entity.Player;
import org.bukkit.entity.WanderingTrader;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerChangedWorldEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerRespawnEvent;
import org.bukkit.event.player.PlayerTeleportEvent;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.MerchantRecipe;
import org.bukkit.persistence.PersistentDataContainer;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.Plugin;
import org.jspecify.annotations.Nullable;

/** Starts one finite, item-barter trader visit per local date when a player reaches its anchor. */
public final class WindmillMerchant implements Listener {

  private static final Duration FLAG_RETRY_AFTER = Duration.ofSeconds(30);

  private final MerchantConfig config;
  private final MerchantAnchor anchor;
  private final InstantSource time;
  private final NamespacedKey visitDay;
  private final ComponentLogger logger;
  private final MerchantGate gate;
  private final Executor mainThread;
  private final Set<UUID> evaluating = new HashSet<>();
  private final Map<UUID, Instant> nextEvaluation = new HashMap<>();
  private long lastUnsafeWarning = Long.MIN_VALUE;

  /** External rollout evaluation and the main-thread completion executor. */
  public record Services(
      InstantSource time, ComponentLogger logger, MerchantGate gate, Executor mainThread) {}

  public WindmillMerchant(Plugin plugin, MerchantConfig config, Services services) {
    if (!config.enabled()) {
      throw new IllegalArgumentException("windmill merchant listener requires enabled config");
    }
    if (plugin.getServer().getWorld(config.world()) == null) {
      throw new IllegalStateException("merchant world is not loaded: " + config.world());
    }
    this.config = config;
    this.anchor = config.anchor();
    this.time = services.time();
    this.visitDay = new NamespacedKey(plugin, "windmill_merchant_visit_day");
    this.logger = services.logger();
    this.gate = services.gate();
    this.mainThread = services.mainThread();
  }

  @EventHandler
  public void onJoin(PlayerJoinEvent event) {
    if (!com.shepherdjerred.thestorm.core.players.Humans.isHuman(event.getPlayer())) return;
    arrive(
        event.getPlayer(),
        requireNonNull(event.getPlayer().getLocation(), "joining player location"));
  }

  @EventHandler
  public void onWorldChange(PlayerChangedWorldEvent event) {
    arrive(
        event.getPlayer(),
        requireNonNull(event.getPlayer().getLocation(), "travelling player location"));
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  public void onMove(PlayerMoveEvent event) {
    var destination = event.getTo();
    if (destination == null || sameBlock(event.getFrom(), destination)) {
      return;
    }
    arrive(event.getPlayer(), destination);
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  public void onTeleport(PlayerTeleportEvent event) {
    var destination = event.getTo();
    if (destination != null) {
      arrive(event.getPlayer(), destination);
    }
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void onRespawn(PlayerRespawnEvent event) {
    arrive(event.getPlayer(), event.getRespawnLocation());
  }

  private void arrive(Player player, Location destination) {
    if (!nearAnchor(destination)) {
      return;
    }
    var world = requireNonNull(destination.getWorld(), "merchant arrival world");
    var now = time.instant();
    var epochDay = LocalDate.ofInstant(now, config.zone()).toEpochDay();
    var previous = readDay(world.getPersistentDataContainer(), "world");
    var playerId = player.getUniqueId();
    var retryAt = nextEvaluation.get(playerId);
    if ((previous != null && previous >= epochDay)
        || (retryAt != null && now.isBefore(retryAt))
        || !evaluating.add(playerId)) {
      return;
    }
    nextEvaluation.put(playerId, now.plus(FLAG_RETRY_AFTER));
    var _ =
        gate.enabled(playerId)
            .whenCompleteAsync(
                (enabled, failure) -> {
                  evaluating.remove(playerId);
                  if (failure != null) {
                    logger.error("Could not evaluate windmill merchant flag", failure);
                    return;
                  }
                  if (Boolean.TRUE.equals(enabled) && player.isOnline()) {
                    var current = requireNonNull(player.getLocation(), "merchant player location");
                    if (nearAnchor(current)) {
                      visit(current);
                    }
                  }
                },
                mainThread);
  }

  private void visit(Location destination) {
    var world = requireNonNull(destination.getWorld(), "merchant arrival world");
    var today = LocalDate.ofInstant(time.instant(), config.zone());
    var epochDay = today.toEpochDay();
    var data = world.getPersistentDataContainer();
    var previous = readDay(data, "world");
    if (previous != null && previous >= epochDay) {
      return;
    }
    if (!world.isChunkLoaded(anchor.x() >> 4, anchor.z() >> 4)) {
      return;
    }
    if (!safeAnchor(world)) {
      if (lastUnsafeWarning != epochDay) {
        logger.warn("Windmill merchant anchor is unsafe in world; no trader spawned");
        lastUnsafeWarning = epochDay;
      }
      return;
    }
    var place = place(world);
    if (reconcileExisting(world, place, epochDay)) {
      data.set(visitDay, PersistentDataType.LONG, epochDay);
      return;
    }
    var recipes = recipes(today);
    world.spawn(
        place,
        WanderingTrader.class,
        trader -> {
          trader.customName(Component.text("Windmill Trader", NamedTextColor.GOLD));
          trader.setCustomNameVisible(true);
          trader.setInvulnerable(true);
          trader.setDespawnDelay(config.visitMinutes() * 60 * 20);
          trader.setRecipes(recipes);
          trader.getPersistentDataContainer().set(visitDay, PersistentDataType.LONG, epochDay);
        });
    data.set(visitDay, PersistentDataType.LONG, epochDay);
    logger.info("Windmill merchant began a main-world visit for {}", today);
  }

  private boolean reconcileExisting(World world, Location place, long today) {
    var foundToday = false;
    for (var entity : world.getNearbyEntities(place, 2, 2, 2)) {
      if (!(entity instanceof WanderingTrader trader)) {
        continue;
      }
      var recorded = readDay(trader.getPersistentDataContainer(), "merchant entity");
      if (recorded == null) {
        continue;
      }
      if (recorded != today || foundToday) {
        trader.remove();
      } else {
        foundToday = true;
      }
    }
    return foundToday;
  }

  private boolean safeAnchor(World world) {
    if (anchor.y() <= world.getMinHeight() || anchor.y() + 1 >= world.getMaxHeight()) {
      return false;
    }
    return world.getBlockAt(anchor.x(), anchor.y() - 1, anchor.z()).getType().isSolid()
        && world.getBlockAt(anchor.x(), anchor.y(), anchor.z()).getType().isAir()
        && world.getBlockAt(anchor.x(), anchor.y() + 1, anchor.z()).getType().isAir();
  }

  private boolean nearAnchor(Location location) {
    var world = location.getWorld();
    if (world == null || !world.getName().equals(config.world())) {
      return false;
    }
    long east = (long) location.getBlockX() - anchor.x();
    long up = (long) location.getBlockY() - anchor.y();
    long south = (long) location.getBlockZ() - anchor.z();
    return Math.abs(up) <= 5
        && east * east + south * south <= (long) config.arrivalRadius() * config.arrivalRadius();
  }

  private Location place(World world) {
    return new Location(world, anchor.x() + 0.5, anchor.y(), anchor.z() + 0.5);
  }

  private @Nullable Long readDay(PersistentDataContainer data, String owner) {
    if (data.has(visitDay) && !data.has(visitDay, PersistentDataType.LONG)) {
      throw new IllegalStateException("invalid merchant visit day on " + owner);
    }
    return data.get(visitDay, PersistentDataType.LONG);
  }

  private static List<MerchantRecipe> recipes(LocalDate date) {
    var recipes = new ArrayList<MerchantRecipe>();
    for (var offer : MerchantStock.forDate(date)) {
      var result = result(offer);
      var recipe = new MerchantRecipe(result, offer.maxUses());
      recipe.addIngredient(new ItemStack(cost(offer.item()), offer.costCount()));
      recipe.setExperienceReward(false);
      recipe.setPriceMultiplier(0);
      recipe.setDemand(0);
      recipe.setSpecialPrice(0);
      recipe.setIgnoreDiscounts(true);
      recipes.add(recipe);
    }
    return List.copyOf(recipes);
  }

  private static ItemStack result(MerchantStock.Offer offer) {
    var item =
        switch (offer.item()) {
          case BREAD -> Material.BREAD;
          case TORCH -> Material.TORCH;
          case LANTERN -> Material.LANTERN;
        };
    return new ItemStack(item, offer.resultCount());
  }

  private static Material cost(MerchantStock.Item item) {
    return switch (item) {
      case BREAD -> Material.WHEAT;
      case TORCH -> Material.COAL;
      case LANTERN -> Material.IRON_INGOT;
    };
  }

  private static boolean sameBlock(Location a, Location b) {
    return Objects.equals(a.getWorld(), b.getWorld())
        && a.getBlockX() == b.getBlockX()
        && a.getBlockY() == b.getBlockY()
        && a.getBlockZ() == b.getBlockZ();
  }
}
