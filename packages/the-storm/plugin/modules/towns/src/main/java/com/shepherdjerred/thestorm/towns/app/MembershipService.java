package com.shepherdjerred.thestorm.towns.app;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.towns.domain.claiming.ClaimLimits;
import com.shepherdjerred.thestorm.towns.domain.town.Invitations;
import com.shepherdjerred.thestorm.towns.domain.town.Membership;
import com.shepherdjerred.thestorm.towns.domain.town.MembershipPolicy;
import com.shepherdjerred.thestorm.towns.domain.town.PendingTransfers;
import com.shepherdjerred.thestorm.towns.domain.town.PlayerRef;
import com.shepherdjerred.thestorm.towns.domain.town.Town;
import com.shepherdjerred.thestorm.towns.domain.town.TownProblem;
import java.time.Duration;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.function.BooleanSupplier;
import java.util.function.Supplier;

/**
 * Joining, leaving and running a town: invitations, kicks, ranks, handovers and renames. Changes
 * become visible in memory once saved through {@link Settling}; invitations and pending handovers
 * live in memory only. Main thread only.
 */
public final class MembershipService {

  private final Settling settling;
  private final Invitations invitations;
  private final PendingTransfers transfers;
  private final Hooks hooks;

  /**
   * What membership needs from outside the town itself.
   *
   * @param levels players' live Governor levels
   * @param limits how much land a town may hold at an owner's level
   * @param departures told once a player's leaving or kick is saved
   */
  public record Hooks(
      OwnerLevels levels,
      ClaimLimits limits,
      Departures departures,
      BooleanSupplier locksSettling) {
    public Hooks(OwnerLevels levels, ClaimLimits limits, Departures departures) {
      this(levels, limits, departures, () -> false);
    }
  }

  /** Told when a player has left a town, or been kicked from it, and that is saved. */
  @FunctionalInterface
  public interface Departures {

    /** Nobody listens. */
    Departures NONE = (townId, player, lockIds) -> {};

    void left(UUID townId, UUID player, Set<UUID> lockIds);
  }

  public MembershipService(Settling settling, MembershipPolicy policy, Hooks hooks) {
    this.settling = settling;
    this.invitations = new Invitations(policy.inviteExpiry());
    this.transfers = new PendingTransfers(policy.transferWindow());
    this.hooks = hooks;
  }

  /** Invites {@code invitee} to {@code inviter}'s town; returns that town. */
  public Result<Town, List<TownProblem>> invite(UUID inviter, PlayerRef invitee) {
    if (settling.isPlayerBusy(inviter) || settling.isPlayerBusy(invitee.id())) {
      return Result.err(List.of(new TownProblem.Busy()));
    }
    return Membership.invite(inviter, invitee, state())
        .map(
            town -> {
              invitations.invite(town.id(), invitee.id(), now());
              return town;
            });
  }

  /** {@code player} joins the town named {@code townName}, which invited them. */
  public Result<Change<Town>, List<TownProblem>> accept(UUID player, String townName) {
    return named(townName)
        .flatMap(town -> notBusy(town, player))
        .flatMap(
            town ->
                Membership.join(
                    player, town, invitations.isInvited(town.id(), player, now()), state()))
        .map(
            town -> {
              return save(town, player, () -> invitations.forgetInvitee(player));
            });
  }

  /** {@code player} turns down the town named {@code townName}; returns that town. */
  public Result<Town, List<TownProblem>> deny(UUID player, String townName) {
    return named(townName)
        .flatMap(town -> notBusy(town, player))
        .flatMap(
            town ->
                invitations.withdraw(town.id(), player, now())
                    ? Result.ok(town)
                    : Result.err(List.of(new TownProblem.NotInvited(town.name()))));
  }

  /** The towns whose invitations {@code player} may still accept. */
  public List<Town> invitationsFor(UUID player) {
    return invitations.openFor(player, now()).stream()
        .flatMap(id -> state().town(id).stream())
        .toList();
  }

  /** {@code player} leaves; once saved, their locks in the town's claims pass to its owner. */
  public Result<Change<Town>, List<TownProblem>> leave(UUID player) {
    return departing(player, player, () -> Membership.leave(player, state()));
  }

  /** {@code target} is kicked; once saved, their locks in the town's claims pass to its owner. */
  public Result<Change<Town>, List<TownProblem>> kick(UUID actor, PlayerRef target) {
    return departing(actor, target.id(), () -> Membership.kick(actor, target, state()));
  }

  private Result<Change<Town>, List<TownProblem>> departing(
      UUID actor, UUID departed, Supplier<Result<Town, List<TownProblem>>> rule) {
    if (hooks.locksSettling().getAsBoolean()
        || settling.isPlayerBusy(actor)
        || settling.isPlayerBusy(departed)) {
      return Result.err(List.of(new TownProblem.Busy()));
    }
    return rule.get().map(town -> saveDeparture(town, departed));
  }

  public Result<Change<Town>, List<TownProblem>> promote(UUID actor, PlayerRef target) {
    return unlessBusy(
        actor, target.id(), () -> Membership.promote(actor, target, state()), town -> {});
  }

  public Result<Change<Town>, List<TownProblem>> demote(UUID actor, PlayerRef target) {
    return unlessBusy(
        actor, target.id(), () -> Membership.demote(actor, target, state()), town -> {});
  }

  /**
   * Records that {@code actor} wants to hand their town to {@code target}; they confirm with {@link
   * #confirmTransfer} within the configured window.
   */
  public Result<Town, List<TownProblem>> requestTransfer(UUID actor, PlayerRef target) {
    if (settling.isPlayerBusy(actor) || settling.isPlayerBusy(target.id())) {
      return Result.err(List.of(new TownProblem.Busy()));
    }
    return Membership.transferable(actor, target, state())
        .map(
            town -> {
              transfers.request(town.id(), target, now());
              return town;
            });
  }

  /**
   * Hands {@code actor}'s town to the player they named in {@link #requestTransfer}. The new owner
   * must be online, hold Governor I or better, and be able to hold the town's land at their level.
   * A refused confirmation keeps the request, so it can be retried until it expires.
   */
  public Result<Change<Town>, List<TownProblem>> confirmTransfer(UUID actor) {
    var town = state().townOf(actor);
    var target = town.flatMap(found -> transfers.pending(found.id(), now()));
    if (town.isEmpty() || target.isEmpty()) {
      return Result.err(List.of(new TownProblem.NoPendingTransfer()));
    }
    var live = hooks.levels().liveLevel(target.get().id());
    var level = live.isPresent() ? live.getAsInt() : 0;
    var successor =
        new Membership.Successor(
            live.isPresent(),
            level,
            hooks.limits().maxClaims(town.get().withGovernorLevel(level)),
            state().claimCount(town.get().id()));
    return unlessBusy(
        actor,
        target.get().id(),
        () -> Membership.transfer(actor, target.get(), successor, state()),
        done -> transfers.done(done.id()));
  }

  /** How long an owner has to confirm a handover. */
  public Duration transferWindow() {
    return transfers.window();
  }

  /** Renames {@code actor}'s town; the web map is redrawn once saved. */
  public Result<Change<Town>, List<TownProblem>> rename(UUID actor, String name) {
    return unlessBusy(
        actor,
        actor,
        () -> Membership.rename(actor, name, state()),
        town -> settling.events().landChanged(town.id()));
  }

  /** Forgets every invitation and handover of {@code townId}, for when the town is deleted. */
  public void forgetTown(UUID townId) {
    invitations.forgetTown(townId);
    transfers.done(townId);
  }

  /** Something to do with a town once a change to it is saved. */
  @FunctionalInterface
  private interface TownAction {
    void run(Town town);
  }

  /**
   * Checks {@code rule} and saves the town it returns, unless {@code actor}, {@code touched} or
   * their towns are being saved: a change is never checked against a state that may be undone.
   */
  private Result<Change<Town>, List<TownProblem>> unlessBusy(
      UUID actor,
      UUID touched,
      Supplier<Result<Town, List<TownProblem>>> rule,
      TownAction afterSave) {
    if (settling.isPlayerBusy(actor) || settling.isPlayerBusy(touched)) {
      return Result.err(List.of(new TownProblem.Busy()));
    }
    return rule.get().map(town -> save(town, touched, () -> afterSave.run(town)));
  }

  private Result<Town, List<TownProblem>> notBusy(Town town, UUID touched) {
    var current = state().town(town.id()).orElseThrow();
    var players = new HashSet<>(current.members().keySet());
    players.add(touched);
    return settling.isBusy(new Settling.Busy(town.id(), players, Set.of()))
        ? Result.err(List.of(new TownProblem.Busy()))
        : Result.ok(town);
  }

  private Change<Town> save(Town updated, UUID touched, Runnable afterSave) {
    var players = new HashSet<>(state().town(updated.id()).orElseThrow().members().keySet());
    players.addAll(updated.members().keySet());
    players.add(touched);
    return settling.persist(
        updated,
        settling.store().saveTown(updated),
        new Settling.Busy(updated.id(), players, Set.of()),
        () -> {
          state().replaceTown(updated);
          afterSave.run();
        });
  }

  private Change<Town> saveDeparture(Town updated, UUID departed) {
    var players = new HashSet<>(state().town(updated.id()).orElseThrow().members().keySet());
    players.addAll(updated.members().keySet());
    players.add(departed);
    return settling.persistResult(
        updated,
        settling.store().saveDeparture(updated, departed),
        new Settling.Busy(updated.id(), players, Set.of()),
        ids -> {
          state().replaceTown(updated);
          state().removeClaimTrust(updated.id(), departed);
          hooks.departures().left(updated.id(), departed, ids);
        });
  }

  private Result<Town, List<TownProblem>> named(String townName) {
    return state()
        .named(townName)
        .<Result<Town, List<TownProblem>>>map(Result::ok)
        .orElseGet(() -> Result.err(List.of(new TownProblem.NoSuchTown(townName))));
  }

  private TownsState state() {
    return settling.state();
  }

  private Instant now() {
    return settling.clocks().time().instant();
  }
}
