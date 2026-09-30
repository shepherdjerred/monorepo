package com.shepherdjerred.thestorm.towns.domain.treasury;

import com.shepherdjerred.thestorm.towns.domain.town.TownRole;

/** Why a treasury deposit, withdrawal or look was refused. */
public sealed interface TreasuryProblem {

  /** The player is not in a town. */
  record NotInTown() implements TreasuryProblem {}

  /** Members may pay in but not take out; owners and assistants withdraw. */
  record CannotWithdraw(TownRole role) implements TreasuryProblem {}

  /** The paying side holds only {@code balance} crystals. */
  record Insufficient(long balance) implements TreasuryProblem {}

  /** The town is being changed or deleted; its treasury waits until that is saved. */
  record Busy() implements TreasuryProblem {}
}
