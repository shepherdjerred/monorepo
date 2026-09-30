package com.shepherdjerred.thestorm.towns.domain.town;

import com.shepherdjerred.thestorm.core.result.Result;
import java.util.List;
import java.util.UUID;

/**
 * Who may join, leave, rank and run a town. Each rule returns the town as it would be after the
 * change, or why the change is refused. Ranks:
 *
 * <ul>
 *   <li>the owner renames, hands over and deletes the town, and promotes and demotes members;
 *   <li>assistants (and the owner) invite players and kick those ranked below them;
 *   <li>members may leave; the owner cannot, and must hand the town over or delete it.
 * </ul>
 */
public final class Membership {

  private Membership() {}

  /** The town {@code inviter} invites {@code invitee} to. */
  public static Result<Town, List<TownProblem>> invite(
      UUID inviter, PlayerRef invitee, TownDirectory towns) {
    return managerOf(inviter, towns)
        .flatMap(
            town -> {
              if (invitee.id().equals(inviter)) {
                return err(new TownProblem.NotYourself());
              }
              if (towns.townOf(invitee.id()).isPresent()) {
                return err(new TownProblem.TargetInTown(invitee.name()));
              }
              return Result.ok(town);
            });
  }

  /** {@code town} with {@code player} joined as a member, if they were invited. */
  public static Result<Town, List<TownProblem>> join(
      UUID player, Town town, boolean invited, TownDirectory towns) {
    var current = towns.townOf(player);
    if (current.isPresent()) {
      return err(new TownProblem.AlreadyInTown(current.get().name()));
    }
    if (!invited) {
      return err(new TownProblem.NotInvited(town.name()));
    }
    return Result.ok(town.withMember(player, TownRole.MEMBER));
  }

  /** {@code player}'s town without them. */
  public static Result<Town, List<TownProblem>> leave(UUID player, TownDirectory towns) {
    return townOf(player, towns)
        .flatMap(
            town ->
                town.roleOf(player).orElseThrow() == TownRole.OWNER
                    ? err(new TownProblem.OwnerCannotLeave())
                    : Result.ok(town.withoutMember(player)));
  }

  /** {@code actor}'s town without {@code target}, who must rank below them. */
  public static Result<Town, List<TownProblem>> kick(
      UUID actor, PlayerRef target, TownDirectory towns) {
    return managerOf(actor, towns)
        .flatMap(town -> memberOf(town, actor, target))
        .flatMap(
            town -> {
              var actorRole = town.roleOf(actor).orElseThrow();
              var targetRole = town.roleOf(target.id()).orElseThrow();
              return actorRole.outranks(targetRole)
                  ? Result.ok(town.withoutMember(target.id()))
                  : err(new TownProblem.Outranked(target.name()));
            });
  }

  /** {@code actor}'s town with the member {@code target} made an assistant. Owner only. */
  public static Result<Town, List<TownProblem>> promote(
      UUID actor, PlayerRef target, TownDirectory towns) {
    return rank(actor, target, towns, TownRole.ASSISTANT);
  }

  /** {@code actor}'s town with the assistant {@code target} made a member. Owner only. */
  public static Result<Town, List<TownProblem>> demote(
      UUID actor, PlayerRef target, TownDirectory towns) {
    return rank(actor, target, towns, TownRole.MEMBER);
  }

  /**
   * {@code actor}'s town handed to its member {@code target}, as {@code successor} describes them.
   * Owner only; the old owner stays on as an assistant. The new owner must be online, hold Governor
   * I or better, and be able to hold the town's land at their level, so a handover never launders a
   * town past its limits.
   */
  public static Result<Town, List<TownProblem>> transfer(
      UUID actor, PlayerRef target, Successor successor, TownDirectory towns) {
    return ownerOf(actor, towns)
        .flatMap(town -> memberOf(town, actor, target))
        .flatMap(
            town -> {
              if (!successor.online()) {
                return err(new TownProblem.TargetOffline(target.name()));
              }
              if (successor.governorLevel() < 1) {
                return err(new TownProblem.NotAGovernor(target.name()));
              }
              if (successor.claims() > successor.claimLimit()) {
                return err(
                    new TownProblem.TooMuchLand(
                        target.name(), successor.claims(), successor.claimLimit()));
              }
              return Result.ok(town.transferredTo(target.id(), successor.governorLevel()));
            });
  }

  /** {@code actor}'s town, when they own it and {@code target} is another of its members. */
  public static Result<Town, List<TownProblem>> transferable(
      UUID actor, PlayerRef target, TownDirectory towns) {
    return ownerOf(actor, towns).flatMap(town -> memberOf(town, actor, target));
  }

  /**
   * Who would take a town over.
   *
   * @param online whether they are online now
   * @param governorLevel their Governor level now (0 when offline)
   * @param claimLimit the most chunks the town may hold at that level
   * @param claims the chunks the town holds
   */
  public record Successor(boolean online, int governorLevel, int claimLimit, int claims) {}

  /** {@code actor}'s town renamed to {@code name}. Owner only. */
  public static Result<Town, List<TownProblem>> rename(
      UUID actor, String name, TownDirectory towns) {
    return ownerOf(actor, towns)
        .flatMap(
            town -> {
              if (!TownNames.isValid(name)) {
                return err(new TownProblem.InvalidName(name));
              }
              var holder = towns.named(name);
              if (holder.isPresent() && !holder.get().id().equals(town.id())) {
                return err(new TownProblem.NameTaken(name));
              }
              return Result.ok(town.renamed(name));
            });
  }

  private static Result<Town, List<TownProblem>> rank(
      UUID actor, PlayerRef target, TownDirectory towns, TownRole to) {
    return ownerOf(actor, towns)
        .flatMap(town -> memberOf(town, actor, target))
        .flatMap(
            town -> {
              var current = town.roleOf(target.id()).orElseThrow();
              var from = to == TownRole.ASSISTANT ? TownRole.MEMBER : TownRole.ASSISTANT;
              return current == from
                  ? Result.ok(town.withMember(target.id(), to))
                  : err(new TownProblem.AlreadyRanked(target.name(), current));
            });
  }

  /** The town {@code actor} belongs to. */
  public static Result<Town, List<TownProblem>> townOf(UUID actor, TownDirectory towns) {
    return towns
        .townOf(actor)
        .<Result<Town, List<TownProblem>>>map(Result::ok)
        .orElseGet(() -> err(new TownProblem.NotInTown()));
  }

  private static Result<Town, List<TownProblem>> managerOf(UUID actor, TownDirectory towns) {
    return townOf(actor, towns)
        .flatMap(
            town -> {
              var role = town.roleOf(actor).orElseThrow();
              return role.manages()
                  ? Result.ok(town)
                  : err(new TownProblem.CannotManageMembers(role));
            });
  }

  private static Result<Town, List<TownProblem>> ownerOf(UUID actor, TownDirectory towns) {
    return townOf(actor, towns)
        .flatMap(
            town -> {
              var role = town.roleOf(actor).orElseThrow();
              return role == TownRole.OWNER ? Result.ok(town) : err(new TownProblem.NotOwner(role));
            });
  }

  private static Result<Town, List<TownProblem>> memberOf(Town town, UUID actor, PlayerRef target) {
    if (target.id().equals(actor)) {
      return err(new TownProblem.NotYourself());
    }
    return town.roleOf(target.id()).isPresent()
        ? Result.ok(town)
        : err(new TownProblem.NotAMember(target.name()));
  }

  private static Result<Town, List<TownProblem>> err(TownProblem problem) {
    return Result.err(List.of(problem));
  }
}
