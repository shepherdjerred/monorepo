package com.shepherdjerred.thestorm.towns.domain.town;

/** Why a town or membership change was refused. */
public sealed interface TownProblem {

  /** The founder already belongs to a town. */
  record AlreadyInTown(String townName) implements TownProblem {}

  /** The name breaks {@link TownNames}. */
  record InvalidName(String name) implements TownProblem {}

  /** Another town has this name, ignoring case. */
  record NameTaken(String name) implements TownProblem {}

  /** The player is not in a town. */
  record NotInTown() implements TownProblem {}

  /** Only the owner may do this. */
  record NotOwner(TownRole role) implements TownProblem {}

  /** The confirmation did not repeat the town's name. */
  record ConfirmationMismatch(String townName) implements TownProblem {}

  /** A change to this town or player is still being saved. */
  record Busy() implements TownProblem {}

  /** No town has this name. */
  record NoSuchTown(String name) implements TownProblem {}

  /** The player has no invitation (or it expired) from this town. */
  record NotInvited(String townName) implements TownProblem {}

  /** The owner cannot leave; they hand the town over or delete it. */
  record OwnerCannotLeave() implements TownProblem {}

  /** The named player is not a member of the actor's town. */
  record NotAMember(String player) implements TownProblem {}

  /** Members may not invite or kick; owners and assistants do. */
  record CannotManageMembers(TownRole role) implements TownProblem {}

  /** The named player's rank is not below the actor's. */
  record Outranked(String player) implements TownProblem {}

  /** A player cannot invite, kick, rank or hand the town to themselves. */
  record NotYourself() implements TownProblem {}

  /** The named player's rank does not allow this change: they already hold {@code role}. */
  record AlreadyRanked(String player, TownRole role) implements TownProblem {}

  /** The named player already belongs to a town. */
  record TargetInTown(String player) implements TownProblem {}

  /** There is no handover waiting to be confirmed, or it expired. */
  record NoPendingTransfer() implements TownProblem {}

  /** The named player must be online to take the town over. */
  record TargetOffline(String player) implements TownProblem {}

  /** The named player needs Governor I or better to own a town. */
  record NotAGovernor(String player) implements TownProblem {}

  /** At the named player's Governor level the town may hold only {@code limit} chunks. */
  record TooMuchLand(String player, int claims, int limit) implements TownProblem {}

  /** The treasury could not be paid out to the owner, so the town was kept. */
  record PayoutFailed() implements TownProblem {}
}
