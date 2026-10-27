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
        .ifPresent(
            town ->
                problems.add(
                    town.isCamp()
                        ? new TownProblem.AlreadyInCamp()
                        : new TownProblem.AlreadyInTown(town.name())));
    if (founding.governorLevel() < 1) {
      problems.add(new TownProblem.NeedsGovernor());
    }
    if (!TownNames.isValid(founding.name())) {
      problems.add(new TownProblem.InvalidName(founding.name()));
    } else if (!TownNames.isPublic(founding.name())) {
      problems.add(new TownProblem.ReservedName(founding.name()));
    } else if (towns.named(founding.name()).isPresent()) {
      problems.add(new TownProblem.NameTaken(founding.name()));
    }
    if (!problems.isEmpty()) {
      return Result.err(List.copyOf(problems));
    }
    return Result.ok(
        Town.found(founding.id(), founding.name(), founding.at(), founding.founder())
            .withGovernorLevel(founding.governorLevel()));
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
    if (town.isCamp()) {
      return Result.err(List.of(new TownProblem.UseCampDelete()));
    }
    var role = town.roleOf(player).orElseThrow();
    if (role != TownRole.OWNER) {
      return Result.err(List.of(new TownProblem.NotOwner(role)));
    }
    if (!town.name().toLowerCase(Locale.ROOT).equals(confirmation.toLowerCase(Locale.ROOT))) {
      return Result.err(List.of(new TownProblem.ConfirmationMismatch(town.name())));
    }
    return Result.ok(town);
  }

  /**
   * The camp {@code player} may delete. Only the owner may, and only by repeating {@code delete}.
   */
  public static Result<Town, List<TownProblem>> disbandCamp(
      UUID player, String confirmation, TownDirectory towns) {
    var found = towns.townOf(player);
    if (found.isEmpty()) {
      return Result.err(List.of(new TownProblem.NotInTown()));
    }
    var town = found.get();
    if (!town.isCamp()) {
      return Result.err(List.of(new TownProblem.NotACamp()));
    }
    var role = town.roleOf(player).orElseThrow();
    if (role != TownRole.OWNER) {
      return Result.err(List.of(new TownProblem.NotOwner(role)));
    }
    if (!"delete".equalsIgnoreCase(confirmation)) {
      return Result.err(List.of(new TownProblem.ConfirmCamp()));
    }
    return Result.ok(town);
  }

  /**
   * {@code player}'s camp as a town named {@code name}. The owner needs Governor {@code level} of
   * at least I. Chunks and members stay.
   */
  public static Result<Town, List<TownProblem>> graduate(
      UUID player, String name, int governorLevel, TownDirectory towns) {
    var found = towns.townOf(player);
    if (found.isEmpty()) {
      return Result.err(List.of(new TownProblem.NotInTown()));
    }
    var town = found.get();
    if (!town.isCamp()) {
      return Result.err(List.of(new TownProblem.NotACamp()));
    }
    var role = town.roleOf(player).orElseThrow();
    if (role != TownRole.OWNER) {
      return Result.err(List.of(new TownProblem.NotOwner(role)));
    }
    var problems = new ArrayList<TownProblem>();
    if (governorLevel < 1) {
      problems.add(new TownProblem.NeedsGovernor());
    }
    if (!TownNames.isValid(name)) {
      problems.add(new TownProblem.InvalidName(name));
    } else if (!TownNames.isPublic(name)) {
      problems.add(new TownProblem.ReservedName(name));
    } else if (towns.named(name).filter(holder -> !holder.id().equals(town.id())).isPresent()) {
      problems.add(new TownProblem.NameTaken(name));
    }
    if (!problems.isEmpty()) {
      return Result.err(List.copyOf(problems));
    }
    return Result.ok(town.graduated(name, governorLevel));
  }

  /** A random (version 4) town id drawn from {@code random}. */
  public static UUID newId(RandomGenerator random) {
    var most = (random.nextLong() & 0xFFFF_FFFF_FFFF_0FFFL) | 0x0000_0000_0000_4000L;
    var least = (random.nextLong() & 0x3FFF_FFFF_FFFF_FFFFL) | 0x8000_0000_0000_0000L;
    return new UUID(most, least);
  }
}
