package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.protection.SettledLand;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.Crystals;
import com.shepherdjerred.thestorm.economy.app.EconomyError;
import com.shepherdjerred.thestorm.economy.app.KeyedTransfer;
import com.shepherdjerred.thestorm.economy.app.Receipt;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import com.shepherdjerred.thestorm.qol.app.Ensured;
import com.shepherdjerred.thestorm.qol.app.LandingMemory;
import com.shepherdjerred.thestorm.qol.app.QolStore;
import com.shepherdjerred.thestorm.qol.app.RtpAttempt;
import com.shepherdjerred.thestorm.qol.domain.QolConfig;
import com.shepherdjerred.thestorm.qol.domain.rtp.BlockPoint;
import com.shepherdjerred.thestorm.qol.domain.rtp.RtpDecision;
import com.shepherdjerred.thestorm.qol.domain.rtp.RtpPricing;
import com.shepherdjerred.thestorm.world.app.WildWorlds;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.entity.Player;

/** Random teleport: search, stand still, then charge and move. */
final class RtpFlow {

  private final Set<UUID> busy = new HashSet<>();
  private final Set<UUID> recovering = new HashSet<>();
  private final Map<UUID, Instant> unsavedCooldowns = new HashMap<>();
  private final WildWorlds worlds;
  private final SettledLand land;
  private final QolStore store;
  private final Wallets wallets;
  private final LandingMemory memory;
  private final ModuleContext context;
  private final QolConfig config;
  private final RtpSearch search;
  private final Warmups warmups;
  private final RtpPricing pricing;

  RtpFlow(Ports ports, ModuleContext context, QolConfig config, LandingMemory memory) {
    this.worlds = ports.worlds();
    this.land = ports.land();
    this.store = ports.store();
    this.wallets = ports.wallets();
    this.memory = memory;
    this.context = context;
    this.config = config;
    this.search = new RtpSearch(config, context.scheduler());
    this.warmups = new Warmups(context.scheduler());
    this.pricing =
        new RtpPricing(config.freeForDuration(), config.cooldownDuration(), config.cost());
  }

  Warmups warmups() {
    return warmups;
  }

  /** Reconciles persisted charges after startup or a player joins. */
  void recoverPending() {
    var _ =
        store
            .pendingRtpAttempts()
            .whenCompleteAsync(
                (attempts, failure) -> {
                  if (failure != null) {
                    context.logger().error("Could not load pending RTP charges", failure);
                    return;
                  }
                  for (var attempt : attempts) {
                    if (!busy.contains(attempt.player()) && recovering.add(attempt.id())) {
                      recover(attempt);
                    }
                  }
                },
                context.scheduler().mainThread());
  }

  /** Starts a teleport into {@code worldName}, optionally in {@code biome}. */
  void start(Player player, String worldName, Optional<String> biome) {
    if (!busy.add(player.getUniqueId())) {
      player.sendMessage(Messages.error("Already looking for a place."));
      return;
    }
    var world = destination(player, worldName, biome);
    if (world.isEmpty()) {
      release(player.getUniqueId());
      return;
    }
    var _ =
        store
            .ensure(player.getUniqueId(), context.time().instant())
            .whenCompleteAsync(
                (ensured, failure) ->
                    quoted(player, world.get(), biome, new PricingCheck(ensured, failure)),
                context.scheduler().mainThread());
  }

  void moved(Player player) {
    warmups.moved(player);
  }

  void hurt(UUID player) {
    warmups.hurt(player);
  }

  private void found(Player player, World world, RtpSearch.Outcome outcome, long cost) {
    if (!player.isOnline() || outcome.spot().isEmpty()) {
      release(player.getUniqueId());
      if (outcome.failure() != null) {
        context.logger().error("Could not load chunks for random teleport", outcome.failure());
      }
      if (player.isOnline()) {
        player.sendMessage(
            Messages.error(
                outcome.failure() == null
                    ? "Couldn't find a safe spot. Try again."
                    : "Could not load the destination. Try again later."));
      }
      return;
    }
    var at = outcome.spot().get();
    stand(player, new Location(world, at.x() + 0.5, at.y(), at.z() + 0.5), cost);
  }

  private void quoted(Player player, World world, Optional<String> biome, PricingCheck check) {
    var failure = check.failure();
    if (failure != null) {
      release(player.getUniqueId());
      context.logger().error("Could not price a random teleport", failure);
      if (player.isOnline()) {
        player.sendMessage(Messages.error("Could not check teleport pricing. Try again later."));
      }
      return;
    }
    if (!player.isOnline()) {
      release(player.getUniqueId());
      return;
    }
    var now = context.time().instant();
    var decision =
        pricing.decide(
            check.ensured().profile().firstSeen(),
            latestCooldown(player.getUniqueId(), check.ensured().profile().lastRtp(), now),
            now);
    switch (decision) {
      case RtpDecision.CoolingDown(var remaining) -> {
        release(player.getUniqueId());
        player.sendMessage(
            Messages.error("You can teleport again in " + remaining.toSeconds() + "s."));
      }
      case RtpDecision.Free() -> search(player, world, biome, 0);
      case RtpDecision.Priced(var cost) -> search(player, world, biome, cost);
    }
  }

  private Optional<Instant> latestCooldown(UUID player, Optional<Instant> persisted, Instant now) {
    var unsaved = unsavedCooldowns.get(player);
    if (unsaved == null) {
      return persisted;
    }
    if (!now.isBefore(unsaved.plus(config.cooldownDuration()))) {
      unsavedCooldowns.remove(player, unsaved);
      return persisted;
    }
    return persisted.filter(saved -> saved.isAfter(unsaved)).or(() -> Optional.of(unsaved));
  }

  private void search(Player player, World world, Optional<String> biome, long cost) {
    player.sendMessage(Messages.info("Looking for a place..."));
    search.find(
        request(world, biome), context.random(), outcome -> found(player, world, outcome, cost));
  }

  private void stand(Player player, Location destination, long cost) {
    warmups.start(
        player,
        config.warmupDuration(),
        () -> arrive(player, destination, cost),
        () -> cancelled(player));
  }

  private void cancelled(Player player) {
    release(player.getUniqueId());
    if (player.isOnline()) {
      player.sendMessage(Messages.error("Teleport cancelled."));
    }
  }

  private void arrive(Player player, Location destination, long cost) {
    if (cost == 0) {
      finish(player, destination);
      return;
    }
    var attempt = new RtpAttempt(UUID.randomUUID(), player.getUniqueId(), cost);
    var _ =
        store
            .insertRtpAttempt(attempt)
            .whenCompleteAsync(
                (ignored, failure) -> {
                  if (failure != null) {
                    release(player.getUniqueId());
                    context.logger().error("Could not save an RTP charge intent", failure);
                    if (player.isOnline()) {
                      player.sendMessage(Messages.error("Could not prepare the teleport charge."));
                    }
                    return;
                  }
                  charge(player, destination, attempt);
                },
                context.scheduler().mainThread());
  }

  private void charge(Player player, Location destination, RtpAttempt attempt) {
    var _ =
        wallets
            .transferOnce(
                new KeyedTransfer(
                    attempt.id(),
                    new AccountId.Player(attempt.player()),
                    new AccountId.Server(),
                    Crystals.of(attempt.cost()),
                    "rtp"))
            .whenCompleteAsync(
                (result, failure) ->
                    paid(player, destination, new Charge(attempt, result, failure)),
                context.scheduler().mainThread());
  }

  private void paid(Player player, Location destination, Charge charge) {
    var failure = charge.failure();
    var result = charge.result();
    var attempt = charge.attempt();
    if (failure != null || result == null) {
      release(player.getUniqueId());
      context.logger().error("Could not charge for a random teleport", failure);
      if (recovering.add(attempt.id())) {
        recover(attempt);
      }
      if (player.isOnline()) {
        player.sendMessage(
            Messages.error("Could not process the teleport charge. Try again later."));
      }
      return;
    }
    switch (result) {
      case Result.Ok<Receipt, EconomyError> ignored -> {
        if (!finish(player, destination)) {
          settle(refund(attempt), attempt, "refund failed random teleport");
        } else {
          settle(store.deleteRtpAttempt(attempt.id()), attempt, "settle completed teleport");
        }
      }
      case Result.Err<Receipt, EconomyError> ignored -> {
        release(player.getUniqueId());
        settle(store.deleteRtpAttempt(attempt.id()), attempt, "clear refused charge");
        if (player.isOnline()) {
          player.sendMessage(Messages.error("That costs " + attempt.cost() + " crystals."));
        }
      }
    }
  }

  private boolean finish(Player player, Location destination) {
    release(player.getUniqueId());
    if (!player.isOnline()) {
      return false;
    }
    var world = destination.getWorld();
    if (world == null) {
      throw new IllegalStateException("teleport has no world");
    }
    if (!player.teleport(destination)) {
      player.sendMessage(Messages.error("Teleport failed. Your crystals will be returned."));
      return false;
    }
    var now = context.time().instant();
    memory.remember(world.getName(), destination.getBlockX(), destination.getBlockZ(), now);
    unsavedCooldowns.put(player.getUniqueId(), now);
    var _ =
        store
            .setLastRtp(player.getUniqueId(), now)
            .whenCompleteAsync(
                (ok, failure) -> {
                  if (failure != null) {
                    context.logger().error("Could not record a random teleport", failure);
                  } else {
                    unsavedCooldowns.remove(player.getUniqueId(), now);
                  }
                },
                context.scheduler().mainThread());
    player.sendMessage(Messages.info("Teleported."));
    return true;
  }

  private CompletableFuture<Void> refund(RtpAttempt attempt) {
    return wallets
        .transferOnce(
            new KeyedTransfer(
                attempt.refundKey(),
                new AccountId.Server(),
                new AccountId.Player(attempt.player()),
                Crystals.of(attempt.cost()),
                "rtp refund"))
        .thenCompose(
            result ->
                switch (result) {
                  case Result.Ok<Receipt, EconomyError> ignored ->
                      store.deleteRtpAttempt(attempt.id());
                  case Result.Err<Receipt, EconomyError> refused ->
                      CompletableFuture.failedFuture(
                          new IllegalStateException("RTP refund refused: " + refused.error()));
                });
  }

  private void recover(RtpAttempt attempt) {
    var _ =
        wallets
            .receiptFor(attempt.id())
            .thenCompose(
                receipt ->
                    receipt.isPresent() ? refund(attempt) : store.deleteRtpAttempt(attempt.id()))
            .whenCompleteAsync(
                (ignored, failure) -> {
                  recovering.remove(attempt.id());
                  if (failure != null) {
                    context
                        .logger()
                        .error("Could not reconcile RTP charge {}", attempt.id(), failure);
                  }
                },
                context.scheduler().mainThread());
  }

  private void settle(CompletableFuture<Void> completion, RtpAttempt attempt, String action) {
    var _ =
        completion.whenCompleteAsync(
            (ignored, failure) -> {
              if (failure != null) {
                context.logger().error("Could not {} for {}", action, attempt.player(), failure);
              }
            },
            context.scheduler().mainThread());
  }

  private void release(UUID player) {
    busy.remove(player);
  }

  private Optional<World> destination(Player player, String worldName, Optional<String> biome) {
    var wild = worlds.named(worldName);
    if (wild.isEmpty() || !wild.get().rtp()) {
      player.sendMessage(Messages.error("That world is not open for a random teleport."));
      return Optional.empty();
    }
    if (biome.isPresent() && !config.biome(biome.get())) {
      player.sendMessage(Messages.error("Unknown biome " + biome.get() + "."));
      return Optional.empty();
    }
    var world = context.plugin().getServer().getWorld(worldName);
    if (world == null) {
      throw new IllegalStateException("random-teleport world " + worldName + " is not loaded");
    }
    return Optional.of(world);
  }

  private RtpSearch.Request request(World world, Optional<String> biome) {
    var spawn = world.getSpawnLocation();
    var border = world.getWorldBorder();
    var center = border.getCenter();
    var claims = land.chunks(world.getName());
    var repel = new ArrayList<>(centers(claims));
    repel.addAll(memory.points(world.getName(), context.time().instant()));
    if (claims.isEmpty()) {
      repel.add(new BlockPoint(spawn.getBlockX(), spawn.getBlockZ()));
    }
    return new RtpSearch.Request(
        new RtpSearch.Site(
            world,
            new BlockPoint(spawn.getBlockX(), spawn.getBlockZ()),
            new BlockPoint(center.getBlockX(), center.getBlockZ()),
            (int) border.getSize()),
        new RtpSearch.Target(biome, claims, repel));
  }

  private static java.util.List<BlockPoint> centers(java.util.List<SettledLand.Chunk> claims) {
    var centers = new ArrayList<BlockPoint>(claims.size());
    for (var claim : claims) {
      centers.add(new BlockPoint(claim.x() * 16 + 8, claim.z() * 16 + 8));
    }
    return centers;
  }

  /** Ports random teleport needs, already enabled. */
  record Ports(WildWorlds worlds, SettledLand land, QolStore store, Wallets wallets) {}

  private record Charge(
      RtpAttempt attempt, Result<Receipt, EconomyError> result, Throwable failure) {}

  private record PricingCheck(Ensured ensured, Throwable failure) {}
}
