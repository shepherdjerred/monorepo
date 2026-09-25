package com.shepherdjerred.thestorm.towns.domain.claiming;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.towns.domain.land.ChunkPos;
import com.shepherdjerred.thestorm.towns.domain.land.Claim;
import com.shepherdjerred.thestorm.towns.domain.land.ClaimFlag;
import com.shepherdjerred.thestorm.towns.domain.town.Town;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Validates claiming, unclaiming and flag changes. Each operation runs its rules and reports every
 * problem found, not only the first, so a player learns everything wrong at once.
 */
public final class Claiming {

  private final ClaimPolicy policy;
  private final List<ClaimRule> claimRules;
  private final List<ClaimRule> manageRules;

  /** Claiming with {@code policy}'s flat per-town cap. */
  public Claiming(ClaimPolicy policy) {
    this(policy, ClaimLimits.flat(policy.maxClaimsPerTown()));
  }

  public Claiming(ClaimPolicy policy, ClaimLimits limits) {
    this.policy = policy;
    this.claimRules =
        List.of(
            new ManagerRule(),
            new ClaimableWorldRule(policy.worlds()),
            new OutsideRegionsRule(),
            new UnclaimedRule(),
            new AdjacentRule(),
            new BufferRule(policy.buffer()),
            new LimitRule(limits));
    this.manageRules = List.of(new ManagerRule(), new OwnClaimRule());
  }

  /** The attempt of {@code player}, who must be in a town, on {@code chunk}. */
  public static Result<ClaimAttempt, List<ClaimProblem>> attempt(
      UUID player, Optional<Town> town, ChunkPos chunk, ClaimMap map) {
    return town.<Result<ClaimAttempt, List<ClaimProblem>>>map(
            found -> Result.ok(new ClaimAttempt(player, found, chunk, map)))
        .orElseGet(() -> Result.err(List.of(new ClaimProblem.NotInTown())));
  }

  /** The new claim, with the policy's default flags. */
  public Result<Claim, List<ClaimProblem>> claim(ClaimAttempt attempt) {
    return check(claimRules, attempt)
        .map(ok -> new Claim(attempt.chunk(), attempt.town().id(), policy.newClaimFlags()));
  }

  /** The claim to remove. */
  public Result<Claim, List<ClaimProblem>> unclaim(ClaimAttempt attempt) {
    return check(manageRules, attempt).map(ok -> held(attempt));
  }

  /** The claim with {@code flag} switched to {@code on}. */
  public Result<Claim, List<ClaimProblem>> setFlag(
      ClaimAttempt attempt, ClaimFlag flag, boolean on) {
    return check(manageRules, attempt).map(ok -> held(attempt).withFlag(flag, on));
  }

  private static Claim held(ClaimAttempt attempt) {
    return attempt.map().claimAt(attempt.chunk()).orElseThrow();
  }

  private static Result<ClaimAttempt, List<ClaimProblem>> check(
      List<ClaimRule> rules, ClaimAttempt attempt) {
    var problems = rules.stream().flatMap(rule -> rule.check(attempt).stream()).toList();
    return problems.isEmpty() ? Result.ok(attempt) : Result.err(problems);
  }
}
