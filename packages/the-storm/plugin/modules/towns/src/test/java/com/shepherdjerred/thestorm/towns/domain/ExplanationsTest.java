package com.shepherdjerred.thestorm.towns.domain;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.towns.domain.claiming.ClaimProblem;
import com.shepherdjerred.thestorm.towns.domain.land.ClaimFlag;
import com.shepherdjerred.thestorm.towns.domain.land.ClaimFlags;
import com.shepherdjerred.thestorm.towns.domain.town.TownProblem;
import com.shepherdjerred.thestorm.towns.domain.town.TownRole;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class ExplanationsTest {

  private static String bastion(UUID town) {
    return "Bastion";
  }

  @Test
  void everyClaimProblemReads() {
    var problems =
        List.of(
            new ClaimProblem.NotInTown(),
            new ClaimProblem.CannotManageClaims(TownRole.MEMBER),
            new ClaimProblem.WorldNotClaimable("world_the_end"),
            new ClaimProblem.InsideRegion("Spawn"),
            new ClaimProblem.AlreadyClaimed(Fixtures.TOWN_B),
            new ClaimProblem.NotAdjacent(),
            new ClaimProblem.TooCloseToTown(Fixtures.TOWN_B, 1),
            new ClaimProblem.LimitReached(64),
            new ClaimProblem.NotClaimed(),
            new ClaimProblem.OwnedByOtherTown(Fixtures.TOWN_B));

    assertThat(
            problems.stream()
                .map(problem -> Explanations.explain(problem, ExplanationsTest::bastion)))
        .containsExactly(
            "You are not in a town. Found one with /town create <name>.",
            "Only a town's owner or assistants manage its land; you are a member.",
            "Land in world_the_end cannot be claimed.",
            "Spawn is protected and cannot be claimed.",
            "This chunk already belongs to Bastion.",
            "New claims must share an edge with your town's land; corners do not count.",
            "This chunk is within 1 chunk of Bastion.",
            "Your town already holds 64 chunks, the most it may.",
            "Nobody has claimed this chunk.",
            "This chunk belongs to Bastion, not your town.");
    assertThat(
            Explanations.explain(
                new ClaimProblem.TooCloseToTown(Fixtures.TOWN_B, 2), ExplanationsTest::bastion))
        .isEqualTo("This chunk is within 2 chunks of Bastion.");
  }

  @Test
  void everyTownProblemReads() {
    assertThat(Explanations.explain(new TownProblem.AlreadyInTown("Aegis")))
        .isEqualTo("You already belong to Aegis.");
    assertThat(Explanations.explain(new TownProblem.InvalidName("a b")))
        .isEqualTo("\"a b\" is not a valid town name: use 3 to 20 letters, digits or underscores.");
    assertThat(Explanations.explain(new TownProblem.NameTaken("Aegis")))
        .isEqualTo("A town named Aegis already exists.");
    assertThat(Explanations.explain(new TownProblem.NotInTown()))
        .isEqualTo("You are not in a town.");
    assertThat(Explanations.explain(new TownProblem.NotOwner(TownRole.ASSISTANT)))
        .isEqualTo("Only the town's owner may do that; you are an assistant.");
    assertThat(Explanations.explain(new TownProblem.ConfirmationMismatch("Aegis")))
        .isEqualTo("To delete your town, type its name: /town delete Aegis");
  }

  @Test
  void flagsAreDescribedInTheOrderTheyAreDeclared() {
    assertThat(Explanations.describe(ClaimFlags.of(ClaimFlag.PVP, ClaimFlag.PUBLIC_BUILD)))
        .isEqualTo(
            "pvp on, explosions off, fire-spread off, mob-griefing off, public-build on,"
                + " public-containers off, public-switches off, public-entities off");
    assertThat(Explanations.flagName(ClaimFlag.PUBLIC_CONTAINERS)).isEqualTo("public-containers");
  }
}
