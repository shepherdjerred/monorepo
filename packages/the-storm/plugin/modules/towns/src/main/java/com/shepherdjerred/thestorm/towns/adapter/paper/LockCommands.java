package com.shepherdjerred.thestorm.towns.adapter.paper;

import static com.mojang.brigadier.arguments.StringArgumentType.getString;
import static com.mojang.brigadier.arguments.StringArgumentType.word;
import static java.util.Objects.requireNonNull;
import static java.util.stream.Collectors.joining;

import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import com.mojang.brigadier.context.CommandContext;
import com.mojang.brigadier.tree.LiteralCommandNode;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import com.shepherdjerred.thestorm.towns.app.Change;
import com.shepherdjerred.thestorm.towns.app.LockService;
import com.shepherdjerred.thestorm.towns.domain.Explanations;
import com.shepherdjerred.thestorm.towns.domain.land.BlockPos;
import com.shepherdjerred.thestorm.towns.domain.lock.Lock;
import com.shepherdjerred.thestorm.towns.domain.lock.LockAttempt;
import com.shepherdjerred.thestorm.towns.domain.lock.LockFlag;
import com.shepherdjerred.thestorm.towns.domain.lock.LockGrant;
import com.shepherdjerred.thestorm.towns.domain.lock.LockModes;
import com.shepherdjerred.thestorm.towns.domain.lock.LockProblem;
import com.shepherdjerred.thestorm.towns.domain.lock.LockRules;
import com.shepherdjerred.thestorm.towns.domain.lock.LockType;
import com.shepherdjerred.thestorm.towns.domain.protection.Act;
import com.shepherdjerred.thestorm.towns.domain.protection.Action;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.command.brigadier.Commands;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.BiConsumer;
import java.util.function.Function;
import net.kyori.adventure.text.Component;
import org.bukkit.FluidCollisionMode;
import org.bukkit.block.Block;
import org.bukkit.entity.ArmorStand;
import org.bukkit.entity.ItemFrame;
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
  private final Wallets wallets;
  private final Parts parts;
  private final Map<UUID, Pending> confirming = new HashMap<>();

  private record Pending(Instant until, Runnable action) {}

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

  LockCommands(LockService service, LockGuard locks, Wallets wallets, Parts parts) {
    this.service = service;
    this.locks = locks;
    this.wallets = wallets;
    this.parts = parts;
  }

  void register(Commands commands) {
    commands.register(lockCommand(), "Locks the container you look at, or manages its lock");
    commands.register(
        Commands.literal("unlock").executes(context -> onTarget(context, this::unlock)).build(),
        "Removes your lock from the container you look at");
    commands.register(
        Commands.literal("cprivate")
            .executes(
                context ->
                    onTarget(
                        context, (player, block) -> typed(player, block, LockType.PRIVATE, "")))
            .build(),
        "Locks the container you look at as private");
    commands.register(
        Commands.literal("cinfo").executes(context -> onTarget(context, this::info)).build(),
        "Shows the lock on the container you look at");
    commands.register(
        Commands.literal("cremove").executes(context -> onTarget(context, this::unlock)).build(),
        "Removes your lock from the container you look at");
    commands.register(
        Commands.literal("cmodify").executes(context -> onTarget(context, this::info)).build(),
        "Shows the lock you look at; change its type with /lock");
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
        .then(typeCommand("private", LockType.PRIVATE))
        .then(typeCommand("public", LockType.PUBLIC))
        .then(typeCommand("donation", LockType.DONATION))
        .then(typeCommand("supply", LockType.SUPPLY))
        .then(typeCommand("display", LockType.DISPLAY))
        .then(
            Commands.literal("password")
                .then(
                    Commands.argument("password", word())
                        .executes(
                            context ->
                                onTarget(
                                    context,
                                    (player, block) ->
                                        typed(
                                            player,
                                            block,
                                            LockType.PASSWORD,
                                            getString(context, "password"))))))
        .then(flagCommand("hopper", LockFlag.HOPPER))
        .then(flagCommand("hopperin", LockFlag.HOPPER_IN))
        .then(flagCommand("hopperout", LockFlag.HOPPER_OUT))
        .then(flagCommand("golem", LockFlag.GOLEM))
        .then(flagCommand("magnet", LockFlag.MAGNET))
        .then(flagCommand("autoclose", LockFlag.AUTOCLOSE))
        .then(flagCommand("explosions", LockFlag.EXPLOSIONS))
        .then(flagCommand("exempt", LockFlag.EXEMPT))
        .then(modeCommand())
        .then(adminCommand())
        .build();
  }

  private LiteralArgumentBuilder<CommandSourceStack> modeCommand() {
    return Commands.literal("mode")
        .then(modeLiteral("persist", LockModes.Mode.PERSIST))
        .then(modeLiteral("nolock", LockModes.Mode.NOLOCK))
        .then(modeLiteral("droptransfer", LockModes.Mode.DROP_TRANSFER))
        .then(modeLiteral("quiet", LockModes.Mode.QUIET));
  }

  private LiteralArgumentBuilder<CommandSourceStack> modeLiteral(String name, LockModes.Mode mode) {
    return Commands.literal(name)
        .executes(context -> TownCommands.asPlayer(context, player -> toggleMode(player, mode)));
  }

  private LiteralArgumentBuilder<CommandSourceStack> adminCommand() {
    return Commands.literal("admin")
        .then(
            Commands.literal("expire")
                .executes(context -> TownCommands.asPlayer(context, this::askExpire)))
        .then(
            Commands.literal("banned")
                .executes(context -> TownCommands.asPlayer(context, this::askBanned)))
        .then(
            Commands.literal("confirm")
                .executes(context -> TownCommands.asPlayer(context, this::confirm)))
        .then(
            Commands.literal("remove")
                .executes(
                    context -> onTarget(context, (player, block) -> askRemove(player, block))))
        .then(
            Commands.literal("find")
                .then(
                    Commands.argument(PLAYER, word())
                        .executes(
                            context ->
                                TownCommands.asPlayer(
                                    context, player -> find(player, getString(context, PLAYER))))))
        .then(
            Commands.literal("purge")
                .then(
                    Commands.argument(PLAYER, word())
                        .executes(
                            context ->
                                TownCommands.asPlayer(
                                    context,
                                    player -> askPurge(player, getString(context, PLAYER))))))
        .then(
            Commands.literal("owner")
                .then(
                    Commands.argument(PLAYER, word())
                        .executes(
                            context ->
                                onTarget(
                                    context,
                                    (player, block) ->
                                        askOwner(player, block, getString(context, PLAYER))))));
  }

  private LiteralArgumentBuilder<CommandSourceStack> typeCommand(String name, LockType type) {
    return Commands.literal(name)
        .executes(context -> onTarget(context, (player, block) -> typed(player, block, type, "")));
  }

  private LiteralArgumentBuilder<CommandSourceStack> flagCommand(String name, LockFlag flag) {
    return Commands.literal(name)
        .then(
            Commands.literal("on")
                .executes(
                    context ->
                        onTarget(context, (player, block) -> flag(player, block, flag, true))))
        .then(
            Commands.literal("off")
                .executes(
                    context ->
                        onTarget(context, (player, block) -> flag(player, block, flag, false))));
  }

  private int onTarget(
      CommandContext<CommandSourceStack> context, BiConsumer<Player, Block> action) {
    return TownCommands.asPlayer(
        context,
        player -> {
          var lookedAt = player.getTargetEntity(REACH);
          if (lookedAt instanceof ItemFrame || lookedAt instanceof ArmorStand) {
            entityTarget = true;
            try {
              action.accept(player, lookedAt.getLocation().getBlock());
            } finally {
              entityTarget = false;
            }
            return;
          }
          var block = player.getTargetBlockExact(REACH, FluidCollisionMode.NEVER);
          if (block == null || !parts.kinds().isLockable(block.getType())) {
            player.sendMessage(
                Notices.error(
                    "Look at a chest, barrel, shulker box, copper chest, furnace, smoker, blast"
                        + " furnace, brewing stand, hopper, shelf, crafter, dispenser, dropper,"
                        + " door, trapdoor, fence gate, sign, item frame or armor stand."));
            return;
          }
          action.accept(player, block);
        });
  }

  /** True while a command is acting on an item frame or armor stand rather than a block. */
  private boolean entityTarget;

  /** Locks the container at {@code block} for {@code player}. */
  void lock(Player player, Block block) {
    typed(player, block, LockType.PRIVATE, "");
  }

  /** Locks {@code block} as {@code type}, or switches the lock already there. */
  private void typed(Player player, Block block, LockType type, String password) {
    if (frozen(player, block)) {
      return;
    }
    var existing = covered(block);
    var partner = Chests.partner(block).map(locks::lockOf).orElse(null);
    if (existing != null || partner != null) {
      report(
          player,
          service.type(player.getUniqueId(), lockedPart(block), type, password),
          lock ->
              Notices.success(
                  "This lock is now " + type.name().toLowerCase(java.util.Locale.ROOT) + "."));
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
    var created =
        service.lock(
            player.getUniqueId(),
            blocks.stream().map(LockGuard::position).toList(),
            standing,
            new LockService.Requested(type, password));
    if (created instanceof Result.Ok<Change<Lock>, List<LockProblem>>(var change)) {
      var _ =
          change
              .saved()
              .whenComplete(
                  (saved, failure) -> {
                    if (failure == null) {
                      parts
                          .runtime()
                          .scheduler()
                          .runOnMainThread(
                              () ->
                                  LockFee.charge(
                                      new LockFee.Bill(
                                          wallets, parts.runtime().scheduler(), service, player),
                                      change.value()));
                    }
                  });
    }
    report(
        player,
        created,
        lock ->
            Notices.success(
                "Locked as "
                    + type.name().toLowerCase(java.util.Locale.ROOT)
                    + ". You can grant use or manage access with /lock trust."));
  }

  private void flag(Player player, Block block, LockFlag flag, boolean on) {
    if (frozen(player, block)) {
      return;
    }
    report(
        player,
        service.flag(player.getUniqueId(), lockedPart(block), flag, on),
        lock ->
            Notices.success(
                flag.name().toLowerCase(java.util.Locale.ROOT).replace('_', ' ')
                    + " is "
                    + (on ? "on" : "off")
                    + "."));
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
    if (trustGroup(player, at, name, grant) || trustTown(player, at, name, grant)) {
      return;
    }
    var person = name.startsWith("@") ? name.substring(1) : name;
    var level = name.startsWith("@") && grant.isPresent() ? Optional.of(LockGrant.ADMIN) : grant;
    if (person.isEmpty()) {
      player.sendMessage(Notices.error("Name the player, group or town."));
      return;
    }
    parts
        .names()
        .resolve(
            player,
            person,
            target -> {
              if (frozen(player, block)) {
                return;
              }
              report(
                  player,
                  service.trust(player.getUniqueId(), at, target, level),
                  lock ->
                      Notices.success(
                          level
                              .map(
                                  value ->
                                      target.name()
                                          + " can now "
                                          + switch (value) {
                                            case MANAGE -> "open and break it.";
                                            case ADMIN -> "open it and edit the list.";
                                            case USE -> "open it.";
                                          })
                              .orElseGet(() -> target.name() + " can no longer open it.")));
            });
  }

  private boolean trustGroup(Player player, BlockPos at, String name, Optional<LockGrant> grant) {
    if (!name.regionMatches(true, 0, "g:", 0, 2) || name.length() <= 2) {
      return false;
    }
    var on = grant.isPresent();
    report(
        player,
        service.group(player.getUniqueId(), at, name.substring(2), on),
        lock ->
            Notices.success(
                "Group "
                    + name.substring(2).toLowerCase(java.util.Locale.ROOT)
                    + (on ? " can open it." : " was removed.")));
    return true;
  }

  private boolean trustTown(Player player, BlockPos at, String name, Optional<LockGrant> grant) {
    if (!name.regionMatches(true, 0, "town:", 0, 5) || name.length() <= 5) {
      return false;
    }
    var townName = name.substring(5);
    var town = locks.townNamed(townName).orElse(null);
    if (town == null) {
      player.sendMessage(Notices.error("No town is named " + townName + "."));
      return true;
    }
    var on = grant.isPresent();
    report(
        player,
        service.town(player.getUniqueId(), at, town, on),
        lock -> Notices.success(townName + (on ? " can open it." : " was removed.")));
    return true;
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
    var lock = covered(block);
    var partner = Chests.partner(block).map(locks::lockOf).orElse(null);
    var found = lock != null ? lock : partner;
    if (found == null) {
      player.sendMessage(Notices.info("That is not locked; anyone may open it."));
      return;
    }
    var people = new ArrayList<UUID>();
    people.addAll(
        found.owners().stream()
            .filter(id -> !found.restoration().owners().containsKey(id))
            .toList());
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
                  var resolved = new java.util.HashMap<>(found.restoration().owners());
                  resolved.putAll(names);
                  player.sendMessage(Notices.info(describe(found, resolved)));
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
        + lock.owners().stream().map(nameOf).sorted().collect(joining(", "))
        + (lock.blocks().size() == 2 ? " (both halves)" : "")
        + (lock.options().sharedWithTown() ? "; their town may open it" : "")
        + "; trusted: "
        + trusted
        + (lock.options().redstone() ? "; redstone allowed" : "; redstone blocked")
        + "; "
        + lock.options().type().name().toLowerCase(java.util.Locale.ROOT)
        + ".";
  }

  /** The position of the locked block of the container at {@code block}, or {@code block}. */
  private @Nullable Lock covered(Block block) {
    if (entityTarget) {
      return locks.keptAt(block);
    }
    return locks.lockOf(block);
  }

  private BlockPos lockedPart(Block block) {
    if (covered(block) == null) {
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

  private void toggleMode(Player player, LockModes.Mode mode) {
    var wasQuiet = service.modes().get(player.getUniqueId()).quiet();
    var template = mode == LockModes.Mode.PERSIST ? lookedAtLock(player) : Optional.<UUID>empty();
    var next = service.toggleMode(player.getUniqueId(), mode, template);
    if (wasQuiet && mode != LockModes.Mode.QUIET) {
      return;
    }
    var label =
        switch (mode) {
          case PERSIST -> "persist";
          case NOLOCK -> "nolock";
          case DROP_TRANSFER -> "droptransfer";
          case QUIET -> "quiet";
        };
    player.sendMessage(Notices.success(label + " is " + (next.on(mode) ? "on" : "off") + "."));
  }

  private Optional<UUID> lookedAtLock(Player player) {
    var lookedAt = player.getTargetEntity(REACH);
    if (lookedAt instanceof ItemFrame || lookedAt instanceof ArmorStand) {
      return lockId(lookedAt.getLocation().getBlock(), true);
    }
    var block = player.getTargetBlockExact(REACH, FluidCollisionMode.NEVER);
    return block == null ? Optional.empty() : lockId(block, false);
  }

  private Optional<UUID> lockId(Block block, boolean entity) {
    var lock = locks.lockOf(block);
    if (lock == null && entity) {
      lock = locks.keptAt(block);
    }
    return lock == null ? Optional.empty() : Optional.of(lock.id());
  }

  private void askExpire(Player player) {
    if (!admin(player)) {
      return;
    }
    var doomed =
        LockRules.expired(service.book().all(), service.now(), service.policy().expireDays());
    ask(
        player,
        doomed.size()
            + " locks have not been opened in "
            + service.policy().expireDays()
            + " days.",
        () -> finishRemoval(player, service.removeAll(doomed), "Expired"));
  }

  private void askBanned(Player player) {
    if (!admin(player)) {
      return;
    }
    var banned = new HashSet<UUID>();
    for (var offline : player.getServer().getBannedPlayers()) {
      banned.add(offline.getUniqueId());
    }
    var doomed = LockRules.purge(service.book().all(), banned::contains);
    ask(
        player,
        doomed.size() + " locks belong to banned players.",
        () -> finishRemoval(player, service.removeAll(doomed), "Removed"));
  }

  private void askPurge(Player player, String name) {
    if (!admin(player)) {
      return;
    }
    parts
        .names()
        .resolve(
            player,
            name,
            target -> {
              var doomed =
                  LockRules.purge(service.book().all(), owner -> owner.equals(target.id()));
              ask(
                  player,
                  doomed.size() + " locks belong to " + target.name() + ".",
                  () -> finishRemoval(player, service.removeAll(doomed), "Removed"));
            });
  }

  private void askRemove(Player player, Block block) {
    if (!admin(player)) {
      return;
    }
    var lock = covered(block);
    if (lock == null) {
      player.sendMessage(Notices.error("That is not locked."));
      return;
    }
    var found = lock;
    ask(
        player,
        "Remove the lock at " + found.blocks() + ".",
        () -> finishRemoval(player, service.removeAll(List.of(found)), "Removed"));
  }

  private void askOwner(Player player, Block block, String name) {
    if (!admin(player)) {
      return;
    }
    var at = lockedPart(block);
    parts
        .names()
        .resolve(
            player,
            name,
            target ->
                ask(
                    player,
                    "Give this lock to " + target.name() + ".",
                    () ->
                        report(
                            player,
                            service.forceOwner(at, target.id()),
                            lock -> Notices.success(target.name() + " now owns this lock."))));
  }

  private void find(Player player, String name) {
    if (!admin(player)) {
      return;
    }
    parts
        .names()
        .resolve(
            player,
            name,
            target -> {
              var lines = new ArrayList<String>();
              for (var lock : service.book().all()) {
                if (lock.owner().equals(target.id())) {
                  lines.add(lock.blocks().toString());
                }
              }
              player.sendMessage(
                  Notices.info(
                      lines.isEmpty()
                          ? target.name() + " has no locks."
                          : target.name() + " has " + lines.size() + " locks: " + lines));
            });
  }

  private void confirm(Player player) {
    var pending = confirming.remove(player.getUniqueId());
    if (pending == null || service.now().isAfter(pending.until())) {
      player.sendMessage(Notices.error("Nothing is waiting to be confirmed."));
      return;
    }
    pending.action().run();
  }

  private void ask(Player player, String what, Runnable action) {
    confirming.put(player.getUniqueId(), new Pending(service.now().plusSeconds(30), action));
    player.sendMessage(Notices.info(what + " Run /lock admin confirm."));
  }

  private void finishRemoval(Player player, List<Change<Lock>> removed, String verb) {
    player.sendMessage(Notices.success(verb + " " + removed.size() + " locks."));
  }

  private boolean admin(Player player) {
    if (player.hasPermission(TownsPermissions.ADMIN) || Guard.actor(player).bypass()) {
      return true;
    }
    player.sendMessage(Notices.error("You cannot administer locks."));
    return false;
  }

  private void report(
      Player player,
      Result<Change<Lock>, List<LockProblem>> result,
      Function<Lock, Component> success) {
    switch (result) {
      case Result.Ok<Change<Lock>, List<LockProblem>>(var change) -> {
        if (service.modes().get(player.getUniqueId()).quiet()) {
          var _ =
              change
                  .saved()
                  .whenCompleteAsync(
                      (ok, failure) -> {
                        if (failure != null) {
                          player.sendMessage(
                              Notices.error(
                                  "That could not be saved, so it was undone. Try again."));
                        }
                      },
                      parts.runtime().scheduler().mainThread());
        } else {
          parts.runtime().whenSaved(player, change.saved(), success.apply(change.value()));
        }
      }
      case Result.Err<Change<Lock>, List<LockProblem>>(var problems) ->
          problems.forEach(
              problem -> player.sendMessage(Notices.error(Explanations.explain(problem))));
    }
  }
}
