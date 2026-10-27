package com.shepherdjerred.thestorm.towns.domain.claiming;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.towns.domain.land.ChunkPos;
import com.shepherdjerred.thestorm.towns.domain.land.Claim;
import com.shepherdjerred.thestorm.towns.domain.land.ClaimFlag;
import com.shepherdjerred.thestorm.towns.domain.town.PlayerRef;
import com.shepherdjerred.thestorm.towns.domain.town.Town;
import com.shepherdjerred.thestorm.towns.domain.town.TownRole;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Validates claiming, unclaiming and flag changes. Each operation runs its rules and reports every
 * problem found, not only the first, so a player learns everything wrong at once.
 */
public final class Claiming {

  private final ClaimPolicy policy;
  private final ClaimLimits limits;
  private final List<ClaimRule> claimRules;
  private final List<ClaimRule> manageRules;
  private final List<ClaimRule> unclaimRules;

  /** Claiming with {@code policy}'s limits: a base plus the owner's Governor bonus. */
  public Claiming(ClaimPolicy policy) {
    this(policy, policy.limits());
  }

  public Claiming(ClaimPolicy policy, ClaimLimits limits) {
    this.policy = policy;
    this.limits = limits;
    this.claimRules =
        List.of(
            new ClaimPermissionRule(),
            new ClaimableWorldRule(policy.worlds()),
            new OutsideRegionsRule(),
            new UnclaimedRule(),
            new AdjacentRule(),
            new BufferRule(policy.buffer()),
            new LimitRule(limits));
    this.manageRules = List.of(new ManagerRule(), new OwnClaimRule());
    this.unclaimRules = List.of(new ManagerRule(), new OwnClaimRule(), new ConnectedRemovalRule());
  }

  /** How many chunks each town may hold. */
  public ClaimLimits limits() {
    return limits;
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
    return check(unclaimRules, attempt).map(ok -> held(attempt));
  }

  /** The claim with {@code flag} switched to {@code on}. */
  public Result<Claim, List<ClaimProblem>> setFlag(
      ClaimAttempt attempt, ClaimFlag flag, boolean on) {
    return check(manageRules, attempt).map(ok -> held(attempt).withFlag(flag, on));
  }

  /**
   * The claim trusting {@code player} (when {@code on}) or no longer trusting them. Only for
   * players outside the town: members already have their rank's rights.
   */
  public Result<Claim, List<ClaimProblem>> trust(
      ClaimAttempt attempt, PlayerRef player, boolean on) {
    return check(manageRules, attempt)
        .flatMap(
            ok -> {
              var claim = held(attempt);
              if (attempt.town().roleOf(player.id()).isPresent()) {
                return Result.err(List.of(new ClaimProblem.TrustsMember(player.name())));
              }
              var trusted = claim.trusted().contains(player.id());
              if (on && trusted) {
                return Result.err(List.of(new ClaimProblem.AlreadyTrusted(player.name())));
              }
              if (!on && !trusted) {
                return Result.err(List.of(new ClaimProblem.NotTrusted(player.name())));
              }
              return Result.ok(claim.withTrust(player.id(), on));
            });
  }

  /** The claim with {@code attempt}'s player as its resident. */
  public Result<Claim, List<ClaimProblem>> personal(ClaimAttempt attempt) {
    return check(List.of(new OwnClaimRule()), attempt)
        .flatMap(
            ok -> {
              var claim = held(attempt);
              if (claim.resident().equals(Optional.of(attempt.player()))) {
                return Result.err(List.of(new ClaimProblem.AlreadyPersonal()));
              }
              if (claim.resident().isPresent()) {
                return Result.err(List.of(new ClaimProblem.NotYourChunk()));
              }
              return Result.ok(claim.withResident(Optional.of(attempt.player())));
            });
  }

  /** The claim shared by the whole group again. The resident or the owner may do this. */
  public Result<Claim, List<ClaimProblem>> shared(ClaimAttempt attempt) {
    var held = attempt.map().claimAt(attempt.chunk());
    if (held.isEmpty() || !held.get().townId().equals(attempt.town().id())) {
      return check(List.of(new OwnClaimRule()), attempt).map(ok -> held(attempt));
    }
    var claim = held.get();
    if (claim.resident().isEmpty()) {
      return Result.err(List.of(new ClaimProblem.AlreadyShared()));
    }
    var owner = attempt.role() == TownRole.OWNER;
    var resident = claim.resident().orElseThrow().equals(attempt.player());
    if (!owner && !resident) {
      return Result.err(List.of(new ClaimProblem.NotYourChunk()));
    }
    return Result.ok(claim.withResident(Optional.empty()));
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
