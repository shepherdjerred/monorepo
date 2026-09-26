package com.shepherdjerred.thestorm.towns.domain;

import static java.util.stream.Collectors.joining;

import com.shepherdjerred.thestorm.towns.domain.claiming.ClaimProblem;
import com.shepherdjerred.thestorm.towns.domain.land.ClaimFlag;
import com.shepherdjerred.thestorm.towns.domain.land.ClaimFlags;
import com.shepherdjerred.thestorm.towns.domain.lock.LockProblem;
import com.shepherdjerred.thestorm.towns.domain.pvp.PvpProblem;
import com.shepherdjerred.thestorm.towns.domain.town.TownNames;
import com.shepherdjerred.thestorm.towns.domain.town.TownProblem;
import com.shepherdjerred.thestorm.towns.domain.town.TownRole;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.Locale;
import java.util.UUID;
import java.util.function.Function;

/** The sentences players read when a town or claim command is refused. */
public final class Explanations {

  private static final String BUSY =
      "Your last change is still being saved; try again in a moment.";

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
      case ClaimProblem.WouldDisconnect() ->
          "You cannot unclaim this chunk because it would split your town's land.";
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
      case ClaimProblem.Busy() -> BUSY;
      case ClaimProblem.TrustsMember(var player) ->
          player + " is in your town already; members build everywhere on its land.";
      case ClaimProblem.AlreadyTrusted(var player) -> player + " is already trusted here.";
      case ClaimProblem.NotTrusted(var player) -> player + " is not trusted here.";
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
      case TownProblem.Busy() -> BUSY;
      case TownProblem.NoSuchTown(var name) -> "No town is named " + name + ".";
      case TownProblem.NotInvited(var town) ->
          "You have no invitation from " + town + ", or it has expired.";
      case TownProblem.OwnerCannotLeave() ->
          "Owners cannot leave. Hand the town over with /town transfer <player> or delete it.";
      case TownProblem.NotAMember(var player) -> player + " is not a member of your town.";
      case TownProblem.CannotManageMembers(var role) ->
          "Only a town's owner or assistants invite and kick; you are " + article(role) + ".";
      case TownProblem.Outranked(var player) ->
          "You can only remove members ranked below you, and " + player + " is not.";
      case TownProblem.NotYourself() -> "You can't do that to yourself.";
      case TownProblem.AlreadyRanked(var player, var role) ->
          player + " is " + article(role) + ", so that changes nothing.";
      case TownProblem.TargetInTown(var player) -> player + " already belongs to a town.";
      case TownProblem.NoPendingTransfer() ->
          "There is no handover to confirm. Start one with /town transfer <player>.";
      case TownProblem.TargetOffline(var player) ->
          player + " must be online to take the town over.";
      case TownProblem.NotAGovernor(var player) ->
          player + " needs Governor I or better to own a town.";
      case TownProblem.TooMuchLand(var player, var claims, var limit) ->
          "The town holds "
              + claims
              + " chunks, but at "
              + player
              + "'s Governor level it may hold only "
              + limit
              + ". Unclaim some first.";
      case TownProblem.PayoutFailed() ->
          "The treasury could not be paid out to you, so the town was kept. Try again.";
    };
  }

  public static String explain(LockProblem problem) {
    return switch (problem) {
      case LockProblem.NotLocked() -> "That is not locked.";
      case LockProblem.AlreadyLocked(var yours) ->
          yours ? "You have already locked that." : "Someone else has already locked that.";
      case LockProblem.PlacedBySomeoneElse() -> "Someone else placed that; only they can lock it.";
      case LockProblem.NotYourLand() -> "You can only lock containers on land you may build on.";
      case LockProblem.TownsToLock() ->
          "Nobody placed this, so it belongs to the town; only its owner or assistants can lock"
              + " it.";
      case LockProblem.Unchanged(var setting, var on) ->
          capitalized(setting) + " is already " + (on ? "on" : "off") + " for this lock.";
      case LockProblem.LimitReached(var limit) ->
          "You already hold " + limit + " locks, the most you may. Unlock one first.";
      case LockProblem.NotYourLock() -> "Only the lock's owner can do that.";
      case LockProblem.NotYourself() -> "You always have access to your own locks.";
      case LockProblem.AlreadyTrusted(var player) -> player + " is already trusted on this lock.";
      case LockProblem.NotTrusted(var player) -> player + " is not trusted on this lock.";
      case LockProblem.Busy() -> BUSY;
    };
  }

  /** Explains {@code problem}; {@code now} is when the player asked, for how long to wait. */
  public static String explain(PvpProblem problem, Instant now) {
    return switch (problem) {
      case PvpProblem.AlreadySet(var on) -> "Your PvP is already " + (on ? "on" : "off") + ".";
      case PvpProblem.TooSoon(var next) ->
          "You changed your PvP recently; you can change it again in "
              + wait(Duration.between(now, next))
              + ".";
      case PvpProblem.InFight(var until) ->
          "You were just in a fight; you can change your PvP in "
              + wait(Duration.between(now, until))
              + ".";
      case PvpProblem.Busy() -> BUSY;
    };
  }

  /** A wait as players read it, rounded up: {@code 3 days 4 hours}, {@code 12 minutes}. */
  public static String wait(Duration duration) {
    var minutes = Math.max(1, (duration.toSeconds() + 59) / 60);
    var days = minutes / (24 * 60);
    var hours = minutes / 60 % 24;
    var rest = minutes % 60;
    if (days > 0) {
      return plural(days, "day") + (hours > 0 ? " " + plural(hours, "hour") : "");
    }
    if (hours > 0) {
      return plural(hours, "hour") + (rest > 0 ? " " + plural(rest, "minute") : "");
    }
    return plural(rest, "minute");
  }

  private static String capitalized(String text) {
    return text.isEmpty()
        ? text
        : text.substring(0, 1).toUpperCase(Locale.ROOT) + text.substring(1);
  }

  private static String plural(long count, String unit) {
    return count + " " + unit + (count == 1 ? "" : "s");
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
