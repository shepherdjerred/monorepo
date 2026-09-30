package com.shepherdjerred.thestorm.towns.domain.treasury;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.towns.domain.town.Town;
import com.shepherdjerred.thestorm.towns.domain.town.TownDirectory;
import java.util.UUID;

/**
 * Who may use a town's treasury: every member may see it and pay in; owners and assistants may take
 * money out. When a town is deleted, its treasury goes to the owner.
 */
public final class TreasuryRules {

  private TreasuryRules() {}

  /** The town whose treasury {@code player} may see and pay into. */
  public static Result<Town, TreasuryProblem> member(UUID player, TownDirectory towns) {
    return towns
        .townOf(player)
        .<Result<Town, TreasuryProblem>>map(Result::ok)
        .orElseGet(() -> Result.err(new TreasuryProblem.NotInTown()));
  }

  /** The town whose treasury {@code player} may withdraw from. */
  public static Result<Town, TreasuryProblem> withdrawer(UUID player, TownDirectory towns) {
    return member(player, towns)
        .flatMap(
            town -> {
              var role = town.roleOf(player).orElseThrow();
              return role.manages()
                  ? Result.ok(town)
                  : Result.err(new TreasuryProblem.CannotWithdraw(role));
            });
  }
}
