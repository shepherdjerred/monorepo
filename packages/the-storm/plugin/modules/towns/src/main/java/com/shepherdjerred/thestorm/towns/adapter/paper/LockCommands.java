package com.shepherdjerred.thestorm.towns.adapter.paper;

import static com.mojang.brigadier.arguments.StringArgumentType.getString;
import static com.mojang.brigadier.arguments.StringArgumentType.word;
import static java.util.Objects.requireNonNull;
import static java.util.stream.Collectors.joining;

import com.mojang.brigadier.context.CommandContext;
import com.mojang.brigadier.tree.LiteralCommandNode;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.towns.app.Change;
import com.shepherdjerred.thestorm.towns.app.LockService;
import com.shepherdjerred.thestorm.towns.domain.Explanations;
import com.shepherdjerred.thestorm.towns.domain.land.BlockPos;
import com.shepherdjerred.thestorm.towns.domain.lock.Lock;
import com.shepherdjerred.thestorm.towns.domain.lock.LockAttempt;
import com.shepherdjerred.thestorm.towns.domain.lock.LockGrant;
import com.shepherdjerred.thestorm.towns.domain.lock.LockProblem;
import com.shepherdjerred.thestorm.towns.domain.protection.Act;
import com.shepherdjerred.thestorm.towns.domain.protection.Action;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.command.brigadier.Commands;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.BiConsumer;
import java.util.function.Function;
import net.kyori.adventure.text.Component;
import org.bukkit.FluidCollisionMode;
import org.bukkit.block.Block;
import org.bukkit.entity.Player;
import org.jspecify.annotations.Nullable;

/**
 * {@code /lock}, {@code /lock info}, {@code /lock trust|untrust <player>}, {@code /lock share},
 * {@code /lock redstone} and {@code /unlock}, on the container the player looks at. Locks work on
 * any land; a lock covers both halves of a double chest.
 */
final class LockCommands {

  /** How far away (in blocks) the container a player looks at may be. */
  private static final int REACH = 5;

  private static final String PLAYER = "player";

  private final LockService service;
  private final LockGuard locks;
  private final Parts parts;

  /**
   * What the commands need besides the locks.
   *
   * @param guard land protection, for whether a player may build where a container stands
   * @param kinds which blocks are lockable
   * @param placers who placed each container
   * @param names players by name and names by player
   * @param runtime reports saves
   */
  record Parts(
      Guard guard, BlockKinds kinds, Placers placers, Names names, TownCommands.Services runtime) {}

  LockCommands(LockService service, LockGuard locks, Parts parts) {
    this.service = service;
    this.locks = locks;
    this.parts = parts;
  }

  void register(Commands commands) {
    commands.register(lockCommand(), "Locks the container you look at, or manages its lock");
    commands.register(
        Commands.literal("unlock").executes(context -> onTarget(context, this::unlock)).build(),
        "Removes your lock from the container you look at");
  }

  private LiteralCommandNode<CommandSourceStack> lockCommand() {
    return Commands.literal("lock")
        .executes(context -> onTarget(context, this::lock))
        .then(Commands.literal("info").executes(context -> onTarget(context, this::info)))
        .then(
            Commands.literal("trust")
                .then(
                    Commands.argument(PLAYER, word())
                        .suggests(TownCommands::suggestOnline)
                        .executes(
                            context ->
                                onTarget(
                                    context,
                                    (player, block) ->
                                        trust(
                                            player,
                                            block,
                                            getString(context, PLAYER),
                                            Optional.of(LockGrant.USE))))
                        .then(
                            Commands.literal("manage")
                                .executes(
                                    context ->
                                        onTarget(
                                            context,
                                            (player, block) ->
                                                trust(
                                                    player,
                                                    block,
                                                    getString(context, PLAYER),
                                                    Optional.of(LockGrant.MANAGE)))))))
        .then(
            Commands.literal("untrust")
                .then(
                    Commands.argument(PLAYER, word())
                        .suggests(TownCommands::suggestOnline)
                        .executes(
                            context ->
                                onTarget(
                                    context,
                                    (player, block) ->
                                        trust(
                                            player,
                                            block,
                                            getString(context, PLAYER),
                                            Optional.empty())))))
        .then(
            Commands.literal("share")
                .then(
                    Commands.literal("on")
                        .executes(
                            context ->
                                onTarget(context, (player, block) -> share(player, block, true))))
                .then(
                    Commands.literal("off")
                        .executes(
                            context ->
                                onTarget(context, (player, block) -> share(player, block, false)))))
        .then(
            Commands.literal("redstone")
                .then(
                    Commands.literal("on")
                        .executes(
                            context ->
                                onTarget(
                                    context, (player, block) -> redstone(player, block, true))))
                .then(
                    Commands.literal("off")
                        .executes(
                            context ->
                                onTarget(
                                    context, (player, block) -> redstone(player, block, false)))))
        .build();
  }

  private int onTarget(
      CommandContext<CommandSourceStack> context, BiConsumer<Player, Block> action) {
    return TownCommands.asPlayer(
        context,
        player -> {
          var block = player.getTargetBlockExact(REACH, FluidCollisionMode.NEVER);
          if (block == null || !parts.kinds().isLockable(block.getType())) {
            player.sendMessage(
                Notices.error(
                    "Look at a chest, barrel, shulker box, copper chest, furnace, smoker, blast"
                        + " furnace, brewing stand, hopper, shelf, crafter, dispenser or dropper."));
            return;
          }
          action.accept(player, block);
        });
  }

  /** Locks the container at {@code block} for {@code player}. */
  void lock(Player player, Block block) {
    if (frozen(player, block)) {
      return;
    }
    var blocks = LockGuard.container(block);
    var actor = Guard.actor(player);
    var standing =
        new LockAttempt.Standing(
            placedBy(player.getUniqueId(), blocks),
            mayBuild(player, blocks),
            locks.ground(player, block),
            actor.bypass());
    report(
        player,
        service.lock(
            player.getUniqueId(), blocks.stream().map(LockGuard::position).toList(), standing),
        lock -> Notices.success("Locked. You can grant use or manage access with /lock trust."));
  }

  /** Removes the lock on the container at {@code block}. */
  void unlock(Player player, Block block) {
    if (frozen(player, block)) {
      return;
    }
    report(
        player,
        service.unlock(lockedPart(block), locks.mayUnlock(player, lockedPart(block))),
        lock -> Notices.success("Unlocked. Anyone can open it now."));
  }

  private void trust(Player player, Block block, String name, Optional<LockGrant> grant) {
    if (frozen(player, block)) {
      return;
    }
    var at = lockedPart(block);
    parts
        .names()
        .resolve(
            player,
            name,
            target -> {
              if (frozen(player, block)) {
                return;
              }
              report(
                  player,
                  service.trust(player.getUniqueId(), at, target, grant),
                  lock ->
                      Notices.success(
                          grant
                              .map(
                                  value ->
                                      target.name()
                                          + " can now "
                                          + (value == LockGrant.MANAGE
                                              ? "open and break it."
                                              : "open it."))
                              .orElseGet(() -> target.name() + " can no longer open it.")));
            });
  }

  private void share(Player player, Block block, boolean on) {
    if (frozen(player, block)) {
      return;
    }
    report(
        player,
        service.shareWithTown(player.getUniqueId(), lockedPart(block), on),
        lock -> Notices.success(on ? "Your town can now open it." : "Town sharing is off."));
  }

  private void redstone(Player player, Block block, boolean on) {
    if (frozen(player, block)) {
      return;
    }
    report(
        player,
        service.redstone(player.getUniqueId(), lockedPart(block), on),
        lock -> Notices.success(on ? "Redstone is allowed." : "Redstone is blocked."));
  }

  /**
   * Tells {@code player} who owns the lock on the container at {@code block} and whom it trusts.
   */
  void info(Player player, Block block) {
    var lock = locks.lockOf(block);
    var partner = Chests.partner(block).map(locks::lockOf).orElse(null);
    var found = lock != null ? lock : partner;
    if (found == null) {
      player.sendMessage(Notices.info("That is not locked; anyone may open it."));
      return;
    }
    var people = new ArrayList<UUID>();
    people.add(found.owner());
    people.addAll(found.trusted().keySet());
    var _ =
        parts
            .names()
            .namesOf(people)
            .whenComplete(
                (names, failure) -> {
                  if (failure != null) {
                    player.sendMessage(Notices.error("Could not look up the lock; try again."));
                    return;
                  }
                  player.sendMessage(Notices.info(describe(found, names)));
                });
  }

  private String describe(Lock lock, Map<UUID, String> names) {
    Function<UUID, String> nameOf = id -> requireNonNull(names.get(id), "a name for " + id);
    var trusted =
        lock.trusted().isEmpty()
            ? "nobody else"
            : lock.trusted().entrySet().stream()
                .map(
                    entry ->
                        nameOf.apply(entry.getKey())
                            + " ("
                            + entry.getValue().name().toLowerCase(java.util.Locale.ROOT)
                            + ")")
                .sorted()
                .collect(joining(", "));
    return "Locked by "
        + nameOf.apply(lock.owner())
        + (lock.blocks().size() == 2 ? " (both halves)" : "")
        + (lock.options().sharedWithTown() ? "; their town may open it" : "")
        + "; trusted: "
        + trusted
        + (lock.options().redstone() ? "; redstone allowed" : "; redstone blocked")
        + ".";
  }

  /** The position of the locked block of the container at {@code block}, or {@code block}. */
  private BlockPos lockedPart(Block block) {
    if (locks.lockOf(block) == null) {
      var partner = Chests.partner(block);
      if (partner.isPresent() && locks.lockOf(partner.get()) != null) {
        return LockGuard.position(partner.get());
      }
    }
    return LockGuard.position(block);
  }

  private boolean frozen(Player player, Block block) {
    for (var part : LockGuard.container(block)) {
      var land = parts.guard().land(part.getLocation()).underlyingLand();
      if (land instanceof com.shepherdjerred.thestorm.towns.domain.land.Land.WorkLand
          || (land instanceof com.shepherdjerred.thestorm.towns.domain.land.Land.ParcelLand parcel
              && parcel.parcel().phase()
                  != com.shepherdjerred.thestorm.towns.domain.parcel.ProtectedParcel.Phase
                      .ACTIVE)) {
        player.sendMessage(
            Notices.error(
                "This holding is frozen; its recovery archive retains the container locks."));
        return true;
      }
    }
    return false;
  }

  /** Who placed the container: someone other than {@code player} if anyone else placed a part. */
  private @Nullable UUID placedBy(UUID player, List<Block> blocks) {
    UUID found = null;
    for (var block : blocks) {
      var placer = parts.placers().placedBy(block);
      if (placer != null && !placer.equals(player)) {
        return placer;
      }
      if (placer != null) {
        found = placer;
      }
    }
    return found;
  }

  private boolean mayBuild(Player player, List<Block> blocks) {
    for (var block : blocks) {
      var build = new Act(Action.BUILD, parts.kinds().subject(block.getType()));
      if (!parts.guard().permitsQuietly(player, build, parts.guard().land(block))) {
        return false;
      }
    }
    return true;
  }

  private void report(
      Player player,
      Result<Change<Lock>, List<LockProblem>> result,
      Function<Lock, Component> success) {
    switch (result) {
      case Result.Ok<Change<Lock>, List<LockProblem>>(var change) ->
          parts.runtime().whenSaved(player, change.saved(), success.apply(change.value()));
      case Result.Err<Change<Lock>, List<LockProblem>>(var problems) ->
          problems.forEach(
              problem -> player.sendMessage(Notices.error(Explanations.explain(problem))));
    }
  }
}
