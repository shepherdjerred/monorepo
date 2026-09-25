package com.shepherdjerred.thestorm.towns.domain.town;

import com.shepherdjerred.thestorm.core.result.Result;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.random.RandomGenerator;

/** Founding and deleting towns. */
public final class TownRules {

  private TownRules() {}

  /** The new town, or every reason it cannot be founded. */
  public static Result<Town, List<TownProblem>> found(Founding founding, TownDirectory towns) {
    var problems = new ArrayList<TownProblem>();
    towns
        .townOf(founding.founder())
        .ifPresent(town -> problems.add(new TownProblem.AlreadyInTown(town.name())));
    if (!TownNames.isValid(founding.name())) {
      problems.add(new TownProblem.InvalidName(founding.name()));
    } else if (towns.named(founding.name()).isPresent()) {
      problems.add(new TownProblem.NameTaken(founding.name()));
    }
    if (!problems.isEmpty()) {
      return Result.err(List.copyOf(problems));
    }
    return Result.ok(Town.found(founding.id(), founding.name(), founding.at(), founding.founder()));
  }

  /**
   * The town {@code player} may delete. Only the owner may, and only by repeating the town's name
   * (ignoring case), so a stray command cannot wipe out a town and every claim it holds.
   */
  public static Result<Town, List<TownProblem>> disband(
      UUID player, String confirmation, TownDirectory towns) {
    var found = towns.townOf(player);
    if (found.isEmpty()) {
      return Result.err(List.of(new TownProblem.NotInTown()));
    }
    var town = found.get();
    var role = town.roleOf(player).orElseThrow();
    if (role != TownRole.OWNER) {
      return Result.err(List.of(new TownProblem.NotOwner(role)));
    }
    if (!town.name().toLowerCase(Locale.ROOT).equals(confirmation.toLowerCase(Locale.ROOT))) {
      return Result.err(List.of(new TownProblem.ConfirmationMismatch(town.name())));
    }
    return Result.ok(town);
  }

  /** A random (version 4) town id drawn from {@code random}. */
  public static UUID newId(RandomGenerator random) {
    var most = (random.nextLong() & 0xFFFF_FFFF_FFFF_0FFFL) | 0x0000_0000_0000_4000L;
    var least = (random.nextLong() & 0x3FFF_FFFF_FFFF_FFFFL) | 0x8000_0000_0000_0000L;
    return new UUID(most, least);
  }
}
