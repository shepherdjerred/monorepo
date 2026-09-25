package com.shepherdjerred.thestorm.towns.domain.town;

/** Why founding or deleting a town was refused. */
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
}
