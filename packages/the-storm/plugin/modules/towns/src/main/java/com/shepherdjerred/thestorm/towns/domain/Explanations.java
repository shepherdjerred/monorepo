package com.shepherdjerred.thestorm.towns.domain;

import static java.util.stream.Collectors.joining;

import com.shepherdjerred.thestorm.towns.domain.claiming.ClaimProblem;
import com.shepherdjerred.thestorm.towns.domain.land.ClaimFlag;
import com.shepherdjerred.thestorm.towns.domain.land.ClaimFlags;
import com.shepherdjerred.thestorm.towns.domain.town.TownNames;
import com.shepherdjerred.thestorm.towns.domain.town.TownProblem;
import com.shepherdjerred.thestorm.towns.domain.town.TownRole;
import java.util.Arrays;
import java.util.Locale;
import java.util.UUID;
import java.util.function.Function;

/** The sentences players read when a town or claim command is refused. */
public final class Explanations {

  private Explanations() {}

  /** Explains {@code problem}; {@code townName} names a town by id. */
  public static String explain(ClaimProblem problem, Function<UUID, String> townName) {
    return switch (problem) {
      case ClaimProblem.NotInTown() -> "You are not in a town. Found one with /town create <name>.";
      case ClaimProblem.CannotManageClaims(var role) ->
          "Only a town's owner or assistants manage its land; you are " + article(role) + ".";
      case ClaimProblem.WorldNotClaimable(var world) -> "Land in " + world + " cannot be claimed.";
      case ClaimProblem.InsideRegion(var region) -> region + " is protected and cannot be claimed.";
      case ClaimProblem.AlreadyClaimed(var town) ->
          "This chunk already belongs to " + townName.apply(town) + ".";
      case ClaimProblem.NotAdjacent() ->
          "New claims must share an edge with your town's land; corners do not count.";
      case ClaimProblem.TooCloseToTown(var town, var buffer) ->
          "This chunk is within "
              + buffer
              + " chunk"
              + (buffer == 1 ? "" : "s")
              + " of "
              + townName.apply(town)
              + ".";
      case ClaimProblem.LimitReached(var limit) ->
          "Your town already holds " + limit + " chunks, the most it may.";
      case ClaimProblem.NotClaimed() -> "Nobody has claimed this chunk.";
      case ClaimProblem.OwnedByOtherTown(var town) ->
          "This chunk belongs to " + townName.apply(town) + ", not your town.";
    };
  }

  public static String explain(TownProblem problem) {
    return switch (problem) {
      case TownProblem.AlreadyInTown(var town) -> "You already belong to " + town + ".";
      case TownProblem.InvalidName(var name) ->
          "\""
              + name
              + "\" is not a valid town name: use "
              + TownNames.MIN_LENGTH
              + " to "
              + TownNames.MAX_LENGTH
              + " letters, digits or underscores.";
      case TownProblem.NameTaken(var name) -> "A town named " + name + " already exists.";
      case TownProblem.NotInTown() -> "You are not in a town.";
      case TownProblem.NotOwner(var role) ->
          "Only the town's owner may do that; you are " + article(role) + ".";
      case TownProblem.ConfirmationMismatch(var town) ->
          "To delete your town, type its name: /town delete " + town;
    };
  }

  /** Every flag with its state, such as {@code pvp off, explosions on}. */
  public static String describe(ClaimFlags flags) {
    return Arrays.stream(ClaimFlag.values())
        .map(flag -> flagName(flag) + (flags.has(flag) ? " on" : " off"))
        .collect(joining(", "));
  }

  /** The name players type for {@code flag}, such as {@code public-build}. */
  public static String flagName(ClaimFlag flag) {
    return flag.name().toLowerCase(Locale.ROOT).replace('_', '-');
  }

  private static String article(TownRole role) {
    return switch (role) {
      case OWNER -> "the owner";
      case ASSISTANT -> "an assistant";
      case MEMBER -> "a member";
    };
  }
}
