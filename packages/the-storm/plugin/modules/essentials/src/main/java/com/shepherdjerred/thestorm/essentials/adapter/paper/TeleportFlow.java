package com.shepherdjerred.thestorm.essentials.adapter.paper;

import com.shepherdjerred.thestorm.core.analytics.ProductAnalytics;
import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import com.shepherdjerred.thestorm.core.text.HouseStyle;
import com.shepherdjerred.thestorm.core.world.SealedWorlds;
import com.shepherdjerred.thestorm.essentials.app.GuardRegistry;
import com.shepherdjerred.thestorm.essentials.app.TeleportPayments;
import com.shepherdjerred.thestorm.essentials.app.TeleportPayments.Charge;
import com.shepherdjerred.thestorm.essentials.app.TeleportRefusal;
import com.shepherdjerred.thestorm.essentials.app.TeleportTravel;
import com.shepherdjerred.thestorm.essentials.domain.back.BackEntry;
import com.shepherdjerred.thestorm.essentials.domain.place.DurationText;
import com.shepherdjerred.thestorm.essentials.domain.place.Position;
import com.shepherdjerred.thestorm.essentials.domain.teleport.Exemptions;
import com.shepherdjerred.thestorm.essentials.domain.teleport.Quote;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportKind;
import com.shepherdjerred.thestorm.essentials.domain.teleport.Warmup;
import java.time.Duration;
import java.time.Instant;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;
import java.util.function.Function;
import java.util.function.Supplier;
import net.kyori.adventure.text.Component;
import org.bukkit.Location;
import org.bukkit.entity.Player;
import org.jspecify.annotations.Nullable;

/**
 * Runs a paid teleport on the main thread: guards, quote, warmup, guards again, a safe landing
 * spot, charge, teleport, then the usage and {@code /back} records.
 *
 * <p>Each player is locked from the quote until the teleport finishes or fails, whichever way it
 * fails; leaving the server releases the lock. Crystals are taken only after the landing spot is
 * known to be safe, and returned if the teleport still does not happen. The usage (price multiplier
 * and cooldown) is recorded only once the player has arrived.
 */
final class TeleportFlow implements TeleportTravel {

  private static final String FAILED = "Something went wrong with that teleport. Try again.";

  private final PaperRuntime runtime;
  private final Services services;
  private final Duration warmup;
  private final Arrival arrival;
  private final Map<UUID, Pending> warmingUp = new HashMap<>();
  private final Map<UUID, Ticket> busy = new HashMap<>();
  private final Map<UUID, Landing> landings = new HashMap<>();
  private final Map<UUID, Quote> displayed = new HashMap<>();
  private final java.util.Set<UUID> bookkeepingFailed = new java.util.HashSet<>();
  private @Nullable Function<UUID, CompletableFuture<Instant>> rtpFirstSeen;
  private CompletableFuture<Void> legacyRecovery = CompletableFuture.completedFuture(null);

  TeleportFlow(PaperRuntime runtime, Services services, Duration warmup) {
    this(runtime, services, warmup, Player::teleportAsync);
  }

  TeleportFlow(PaperRuntime runtime, Services services, Duration warmup, Arrival arrival) {
    this.runtime = runtime;
    this.services = services;
    this.warmup = warmup;
    this.arrival = arrival;
  }

  /** Paper's asynchronous move, injectable so the outcome can be exercised without server I/O. */
  @FunctionalInterface
  interface Arrival {
    CompletableFuture<Boolean> move(Player player, Location destination);
  }

  /**
   * What the flow needs from the rest of the module.
   *
   * @param payments pricing and charging
   * @param guards the teleport guards other modules add
   * @param protection land protection, asked for {@code TELEPORT_INTO} on player-chosen places
   * @param back {@code /back} recording
   * @param sealed worlds no teleport may leave or enter
   */
  record Services(
      TeleportPayments payments,
      GuardRegistry guards,
      Protection protection,
      BackRecorder back,
      SealedWorlds sealed) {}

  private record Pending(Ticket ticket, Position start, Cancellable task) {}

  private record Check(Exemptions exemptions, Result<Quote, TeleportRefusal> quote) {}

  @Override
  public void configureRtp(
      Function<UUID, CompletableFuture<Instant>> firstSeen, CompletableFuture<Void> recovered) {
    if (rtpFirstSeen != null) {
      throw new IllegalStateException("RTP policy was already installed");
    }
    rtpFirstSeen = firstSeen;
    legacyRecovery = recovered;
  }

  @Override
  public Policy policy() {
    var rules = services.payments().pricing();
    return new Policy(rules.rtpFreeFor(), rules.window(), rules.allowance());
  }

  @Override
  public void randomTeleport(
      Player player,
      String description,
      Supplier<CompletableFuture<Result<Landing, Component>>> preparation) {
    travel(player, TeleportKind.RTP, description, preparation);
  }

  @Override
  public CompletableFuture<Status> status(Player player) {
    var permissions = exemptions(player);
    var firstSeen = rtpFirstSeen;
    var seen =
        firstSeen == null
            ? CompletableFuture.completedFuture(Instant.EPOCH)
            : legacyRecovery.thenCompose(ready -> firstSeen.apply(player.getUniqueId()));
    return seen.thenCombine(
        services.payments().history(player.getUniqueId()),
        (rtpSeen, history) -> {
          var rules = services.payments().pricing();
          var freeUntil = firstSeen == null ? Instant.EPOCH : rtpSeen.plus(rules.rtpFreeFor());
          var now = runtime.time().instant();
          var quotes = new EnumMap<TeleportKind, Quote>(TeleportKind.class);
          for (var kind : TeleportKind.values()) {
            var free = permissions.free() || (kind == TeleportKind.RTP && now.isBefore(freeUntil));
            quotes.put(
                kind,
                services
                    .payments()
                    .preview(
                        kind, history, new Exemptions(free, permissions.ignoresCooldown()), now));
          }
          return new Status(rules, history, quotes, now, freeUntil);
        });
  }

  private CompletableFuture<Exemptions> exemptionsFor(Player player, TeleportKind kind) {
    var permissions = exemptions(player);
    if (kind != TeleportKind.RTP) {
      return legacyRecovery.thenApply(ready -> permissions);
    }
    var firstSeen = java.util.Objects.requireNonNull(rtpFirstSeen, "RTP policy is required");
    return legacyRecovery
        .thenCompose(ready -> firstSeen.apply(player.getUniqueId()))
        .thenApply(
            seen ->
                new Exemptions(
                    permissions.free()
                        || runtime
                            .time()
                            .instant()
                            .isBefore(seen.plus(services.payments().pricing().rtpFreeFor())),
                    permissions.ignoresCooldown()));
  }

  private CompletableFuture<Check> check(Player payer, TeleportKind kind) {
    return exemptionsFor(payer, kind)
        .thenCompose(
            exemptions ->
                services
                    .payments()
                    .quote(payer.getUniqueId(), kind, exemptions)
                    .thenApply(quote -> new Check(exemptions, quote)));
  }

  @Override
  public void travel(
      Player player,
      TeleportKind kind,
      String description,
      Supplier<CompletableFuture<Result<Landing, Component>>> preparation) {
    var ticket =
        Ticket.self(player, kind, Destination.fixed(Positions.current(player), description));
    if (isBusy(player.getUniqueId())) {
      Say.error(player, Say.TELEPORT, "A teleport is already under way.");
      return;
    }
    if (services.sealed().isSealed(player.getWorld())) {
      Say.error(player, Say.TELEPORT, "You can't teleport out of this world.");
      return;
    }
    var guard = services.guards().check(player.getUniqueId(), Positions.current(player));
    if (guard.isPresent()) {
      player.sendMessage(HouseStyle.error(Say.TELEPORT, guard.orElseThrow()));
      return;
    }
    lock(ticket);
    next(
        check(player, kind),
        ticket,
        "quoting a teleport",
        checked -> {
          if (!active(ticket) || !bothOnline(ticket)) {
            release(ticket);
            return;
          }
          switch (checked.quote()) {
            case Result.Err<Quote, TeleportRefusal>(var refusal) -> {
              release(ticket);
              tellRefusal(ticket, refusal);
            }
            case Result.Ok<Quote, TeleportRefusal>(var quote) ->
                prepare(ticket, quote, preparation);
          }
        });
  }

  private void prepare(
      Ticket ticket,
      Quote quote,
      Supplier<CompletableFuture<Result<Landing, Component>>> preparation) {
    next(
        preparation.get(),
        ticket,
        "preparing a teleport destination",
        result -> {
          switch (result) {
            case Result.Err<Landing, Component>(var reason) -> {
              release(ticket);
              ticket.payer().sendMessage(HouseStyle.error(Say.TELEPORT, reason));
            }
            case Result.Ok<Landing, Component>(var landing) -> {
              if (!active(ticket) || !bothOnline(ticket)) {
                landing.release().run();
                release(ticket);
                return;
              }
              var prepared =
                  Ticket.self(
                      ticket.mover(),
                      ticket.kind(),
                      Destination.fixed(landing.location(), ticket.destination().describe()));
              lock(prepared);
              landings.put(prepared.mover().getUniqueId(), landing);
              if (refused(prepared, landing.location())) {
                release(prepared);
                return;
              }
              beginWarmup(prepared, quote);
            }
          }
        });
  }

  private boolean active(Ticket ticket) {
    return java.util.Objects.equals(busy.get(ticket.mover().getUniqueId()), ticket);
  }

  /** Starts {@code ticket}: checks guards and cooldown, then begins the warmup. */
  void start(Ticket ticket) {
    var mover = ticket.mover();
    var payer = ticket.payer();
    if (isBusy(mover.getUniqueId()) || isBusy(payer.getUniqueId())) {
      Say.error(payer, Say.TELEPORT, "A teleport is already under way.");
      notifyAcceptor(ticket, false);
      return;
    }
    var destination = ticket.destination().resolve();
    if (destination.isEmpty()) {
      Say.error(payer, Say.TELEPORT, "Teleport cancelled: the destination is no longer there.");
      notifyAcceptor(ticket, false);
      return;
    }
    if (refused(ticket, destination.orElseThrow())) {
      notifyAcceptor(ticket, false);
      return;
    }
    lock(ticket);
    next(
        check(payer, ticket.kind()),
        ticket,
        "quoting a teleport",
        checked -> afterQuote(ticket, checked.quote()));
  }

  /** Whether {@code player} is moving or paying in a teleport that has not finished. */
  boolean isBusy(UUID player) {
    return busy.containsKey(player) || bookkeepingFailed.contains(player);
  }

  /** Cancels a warmup because {@code player} moved (or was carried) off its starting block. */
  void moved(Player player, Location to) {
    var pending = warmingUp.get(player.getUniqueId());
    if (pending != null && Warmup.interruptedBy(pending.start(), Positions.of(to))) {
      cancel(player.getUniqueId(), "you moved");
    }
  }

  /** Cancels a warmup because {@code player} took damage. */
  void damaged(Player player) {
    if (warmingUp.containsKey(player.getUniqueId())) {
      cancel(player.getUniqueId(), "you took damage");
    }
  }

  /** {@code player} left: cancels warmups and releases both participants' locks. */
  void left(UUID player) {
    List.copyOf(warmingUp.values()).stream()
        .filter(p -> involves(p.ticket(), player))
        .forEach(p -> cancel(p.ticket().mover().getUniqueId(), "a player left"));
    var ticket = busy.get(player);
    if (ticket != null) {
      release(ticket);
    }
  }

  /** Cancels every warmup, on disable. */
  void cancelAll() {
    warmingUp.values().forEach(pending -> pending.task().cancel());
    warmingUp.clear();
    landings.values().forEach(landing -> landing.release().run());
    landings.clear();
    displayed.clear();
    busy.clear();
  }

  private void afterQuote(Ticket ticket, Result<Quote, TeleportRefusal> quoted) {
    if (!active(ticket) || !bothOnline(ticket)) {
      release(ticket);
      return;
    }
    switch (quoted) {
      case Result.Err<Quote, TeleportRefusal>(var refusal) -> {
        release(ticket);
        tellRefusal(ticket, refusal);
      }
      case Result.Ok<Quote, TeleportRefusal>(var quote) -> beginWarmup(ticket, quote);
    }
  }

  private void beginWarmup(Ticket ticket, Quote quote) {
    displayed.put(ticket.mover().getUniqueId(), quote);
    var price =
        (quote.cost() == 0 ? "free" : quote.cost() + " crystals") + " (" + quote.multiplier() + ")";
    ticket
        .payer()
        .sendMessage(
            HouseStyle.info(
                Say.TELEPORT,
                Component.text(
                        "This teleport costs "
                            + price
                            + "; shared cooldown "
                            + DurationText.format(quote.cooldown())
                            + ". Recent usage: "
                            + quote.previousPoints()
                            + "/"
                            + services.payments().pricing().allowance()
                            + " points. ")
                    .append(TeleportInfoCommands.help(ticket.kind()))));
    if (warmup.isZero()) {
      land(ticket);
      return;
    }
    var mover = ticket.mover();
    Say.info(
        mover,
        Say.TELEPORT,
        "Teleporting to "
            + ticket.destination().describe()
            + " in "
            + DurationText.format(warmup)
            + ". Don't move.");
    var id = mover.getUniqueId();
    var task =
        runtime
            .scheduler()
            .runOnMainThreadLater(
                warmup,
                () -> {
                  var pending = warmingUp.remove(id);
                  if (pending != null) {
                    guarded(pending.ticket(), () -> land(pending.ticket()));
                  }
                });
    warmingUp.put(id, new Pending(ticket, Positions.of(mover), task));
  }

  /** The warmup is over: re-checks guards, finds a safe spot, then charges. */
  private void land(Ticket ticket) {
    if (!active(ticket) || !bothOnline(ticket)) {
      release(ticket);
      return;
    }
    var destination = ticket.destination().resolve();
    if (destination.isEmpty()) {
      release(ticket);
      Say.error(ticket.payer(), Say.TELEPORT, "Teleport cancelled: the destination is gone.");
      return;
    }
    var target = destination.orElseThrow();
    if (refused(ticket, target)) {
      release(ticket);
      return;
    }
    if (SafeLocations.isLoaded(target)) {
      chargeFor(ticket, target);
      return;
    }
    next(
        target.getWorld().getChunkAtAsync(target),
        ticket,
        "loading the destination",
        chunk -> chargeFor(ticket, target));
  }

  private void chargeFor(Ticket ticket, Location target) {
    if (!active(ticket) || !bothOnline(ticket)) {
      release(ticket);
      return;
    }
    var safe = SafeLocations.nearestSafe(target);
    if (safe.isEmpty()) {
      release(ticket);
      Say.error(
          ticket.payer(),
          Say.TELEPORT,
          "Teleport cancelled: there is nowhere safe to stand at "
              + ticket.destination().describe()
              + ".");
      return;
    }
    if (refused(ticket, safe.orElseThrow())) {
      release(ticket);
      return;
    }
    next(
        check(ticket.payer(), ticket.kind()),
        ticket,
        "checking the final teleport price",
        checked -> {
          switch (checked.quote()) {
            case Result.Err<Quote, TeleportRefusal>(var refusal) -> {
              release(ticket);
              tellRefusal(ticket, refusal);
            }
            case Result.Ok<Quote, TeleportRefusal>(var finalQuote) -> {
              if (!active(ticket) || !bothOnline(ticket)) {
                release(ticket);
                return;
              }
              var shown =
                  java.util.Objects.requireNonNull(displayed.get(ticket.mover().getUniqueId()));
              if (finalQuote.cost() > shown.cost()) {
                release(ticket);
                Say.error(
                    ticket.payer(),
                    Say.TELEPORT,
                    "Your price changed. Run the command again for a new quote. /tpinfo");
              } else {
                next(
                    services
                        .payments()
                        .charge(ticket.payer().getUniqueId(), ticket.kind(), checked.exemptions()),
                    ticket,
                    "charging a teleport",
                    charged -> afterCharge(ticket, charged, safe.orElseThrow()));
              }
            }
          }
        });
  }

  private void afterCharge(Ticket ticket, Result<Charge, TeleportRefusal> charged, Location safe) {
    switch (charged) {
      case Result.Err<Charge, TeleportRefusal>(var refusal) -> {
        release(ticket);
        if (bothOnline(ticket)) {
          tellRefusal(ticket, refusal);
        }
      }
      case Result.Ok<Charge, TeleportRefusal>(var payment) -> teleport(ticket, payment, safe);
    }
  }

  private void teleport(Ticket ticket, Charge payment, Location safe) {
    if (!active(ticket) || !bothOnline(ticket)) {
      refundAndRelease(ticket, payment, "a player left");
      return;
    }
    if (refused(ticket, safe)) {
      refundAndRelease(ticket, payment, "travel protection changed");
      return;
    }
    var mover = ticket.mover();
    var left = Positions.of(mover);
    CompletableFuture<Boolean> arrival;
    try {
      arrival = this.arrival.move(mover, safe);
    } catch (RuntimeException e) {
      runtime.report("teleporting a player", e);
      refundAndRelease(ticket, payment, "the teleport failed");
      return;
    }
    runtime.onMain(
        arrival,
        "teleporting a player",
        moved -> {
          if (!Boolean.TRUE.equals(moved)) {
            refundAndRelease(ticket, payment, "the teleport was blocked");
            return;
          }
          services.back().record(mover.getUniqueId(), left, BackEntry.Cause.TELEPORT);
          recordInteraction(ticket);
          runtime.onMain(
              services.payments().confirm(ticket.payer().getUniqueId(), payment),
              "recording teleport usage",
              done -> {
                release(ticket, true);
                if (mover.isOnline()) {
                  Say.success(
                      mover,
                      Say.TELEPORT,
                      "Teleported to " + ticket.destination().describe() + ".");
                }
              },
              failure -> {
                bookkeepingFailed.add(ticket.payer().getUniqueId());
                release(ticket, true);
                if (ticket.payer().isOnline()) {
                  Say.error(
                      ticket.payer(),
                      Say.TELEPORT,
                      "The teleport completed, but payment bookkeeping failed. Tell staff.");
                }
              });
        },
        failure -> refundAndRelease(ticket, payment, "the teleport failed"));
  }

  /** Returns the crystals, then releases the lock and tells the payer once the refund is done. */
  private void refundAndRelease(Ticket ticket, Charge payment, String why) {
    var payer = ticket.payer();
    runtime.onMain(
        services.payments().refund(payment),
        "refunding a teleport",
        refunded -> {
          release(ticket);
          var suffix =
              payment.quote().cost() == 0
                  ? "."
                  : "; your " + payment.quote().cost() + " crystals were refunded.";
          Say.error(payer, Say.TELEPORT, "Teleport cancelled: " + why + suffix);
        },
        failure -> {
          release(ticket);
          Say.error(
              payer,
              Say.TELEPORT,
              "Teleport cancelled: " + why + ", and the refund failed. Tell staff.");
        });
  }

  /**
   * Continues with {@code then} on the main thread; any failure (including one thrown by {@code
   * then}) releases the lock and tells the payer.
   */
  private <T> void next(CompletableFuture<T> future, Ticket ticket, String what, Consumer<T> then) {
    runtime.onMain(future, what, then, failure -> failed(ticket));
  }

  /** Runs {@code step}; if it throws, releases the lock and tells the payer. */
  private void guarded(Ticket ticket, Runnable step) {
    try {
      step.run();
    } catch (RuntimeException e) {
      runtime.report("teleporting", e);
      failed(ticket);
    }
  }

  private void failed(Ticket ticket) {
    release(ticket);
    if (ticket.payer().isOnline()) {
      Say.error(ticket.payer(), Say.TELEPORT, FAILED);
    }
  }

  private void cancel(UUID mover, String why) {
    var pending = warmingUp.remove(mover);
    if (pending == null) {
      return;
    }
    pending.task().cancel();
    release(pending.ticket());
    Say.error(pending.ticket().mover(), Say.TELEPORT, "Teleport cancelled: " + why + ".");
    if (pending.ticket().paidByOther()) {
      Say.error(pending.ticket().payer(), Say.TELEPORT, "Teleport cancelled: " + why + ".");
    }
  }

  private boolean refused(Ticket ticket, Location destination) {
    var refusal = refusal(ticket, destination);
    if (refusal.isEmpty()) {
      return false;
    }
    var message = Component.text("You can't teleport there: ").append(refusal.orElseThrow());
    ticket.payer().sendMessage(HouseStyle.error(Say.TELEPORT, message));
    if (ticket.paidByOther()) {
      ticket.mover().sendMessage(HouseStyle.error(Say.TELEPORT, message));
    }
    return true;
  }

  private Optional<Component> refusal(Ticket ticket, Location destination) {
    if (services.sealed().isSealed(ticket.mover().getWorld())) {
      return Optional.of(Component.text("you can't teleport out of this world."));
    }
    if (services.sealed().isSealed(destination)) {
      return Optional.of(Component.text("that world is closed to teleports."));
    }
    var mover = ticket.mover().getUniqueId();
    var guard = services.guards().check(mover, destination);
    if (guard.isPresent() || !playerChosen(ticket.kind())) {
      return guard;
    }
    return switch (services.protection().check(mover, ProtectedAction.TELEPORT_INTO, destination)) {
      case Decision.Allowed() -> Optional.empty();
      case Decision.Denied(var reason) -> Optional.of(reason);
    };
  }

  /**
   * Places players pick themselves are checked against claims; staff-set spawn and warps are not.
   */
  private static boolean playerChosen(TeleportKind kind) {
    return switch (kind) {
      case HOME, TPA, BACK, RTP -> true;
      case SPAWN, WARP -> false;
    };
  }

  private static void tellRefusal(Ticket ticket, TeleportRefusal refusal) {
    var message =
        switch (refusal) {
          case TeleportRefusal.Cooldown(var cooldown) ->
              "All travel commands share this cooldown. You can teleport again in "
                  + DurationText.format(cooldown.remaining())
                  + ". /tpinfo shows usage and recovery.";
          case TeleportRefusal.CannotAfford(var balance, var required) ->
              "This teleport costs "
                  + required
                  + " crystals; you have "
                  + balance
                  + ". Frequent trips increase prices. /tpinfo shows recovery.";
        };
    Say.error(ticket.payer(), Say.TELEPORT, message);
  }

  private void lock(Ticket ticket) {
    busy.put(ticket.mover().getUniqueId(), ticket);
    busy.put(ticket.payer().getUniqueId(), ticket);
  }

  private void release(Ticket ticket) {
    release(ticket, false);
  }

  private void recordInteraction(Ticket ticket) {
    switch (ticket.kind()) {
      case HOME ->
          runtime
              .analytics()
              .interaction(ticket.mover().getUniqueId(), ProductAnalytics.Action.HOME_USED);
      case WARP ->
          runtime
              .analytics()
              .interaction(ticket.mover().getUniqueId(), ProductAnalytics.Action.WARP_USED);
      case RTP ->
          runtime
              .analytics()
              .interaction(ticket.mover().getUniqueId(), ProductAnalytics.Action.RANDOM_TELEPORT);
      case SPAWN, TPA, BACK -> {
        /* Outside the first feature inventory. */
      }
    }
  }

  private void release(Ticket ticket, boolean arrived) {
    var owned = busy.remove(ticket.mover().getUniqueId(), ticket);
    busy.remove(ticket.payer().getUniqueId(), ticket);
    if (owned) {
      displayed.remove(ticket.mover().getUniqueId());
      var landing = landings.remove(ticket.mover().getUniqueId());
      if (landing != null) {
        try {
          if (arrived) {
            landing.arrived().run();
          }
        } finally {
          landing.release().run();
        }
      }
      notifyAcceptor(ticket, arrived);
    }
  }

  private static void notifyAcceptor(Ticket ticket, boolean arrived) {
    ticket
        .acceptor()
        .ifPresent(
            player -> {
              if (player.isOnline()) {
                if (arrived) {
                  Say.success(player, Say.TELEPORT, "The teleport request completed.");
                } else {
                  Say.error(player, Say.TELEPORT, "The teleport request was cancelled.");
                }
              }
            });
  }

  private static boolean involves(Ticket ticket, UUID player) {
    return ticket.mover().getUniqueId().equals(player)
        || ticket.payer().getUniqueId().equals(player);
  }

  private static boolean bothOnline(Ticket ticket) {
    return ticket.mover().isOnline() && ticket.payer().isOnline();
  }

  private static Exemptions exemptions(Player payer) {
    return new Exemptions(
        payer.hasPermission(EssentialsPermissions.TELEPORT_FREE),
        payer.hasPermission(EssentialsPermissions.TELEPORT_NO_COOLDOWN));
  }
}
