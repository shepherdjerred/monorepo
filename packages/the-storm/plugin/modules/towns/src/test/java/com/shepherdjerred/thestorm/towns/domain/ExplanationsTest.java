package com.shepherdjerred.thestorm.towns.domain;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.towns.domain.claiming.ClaimProblem;
import com.shepherdjerred.thestorm.towns.domain.land.ClaimFlag;
import com.shepherdjerred.thestorm.towns.domain.land.ClaimFlags;
import com.shepherdjerred.thestorm.towns.domain.lock.LockProblem;
import com.shepherdjerred.thestorm.towns.domain.pvp.PvpProblem;
import com.shepherdjerred.thestorm.towns.domain.town.TownProblem;
import com.shepherdjerred.thestorm.towns.domain.town.TownRole;
import java.time.Duration;
import java.time.Instant;
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
                + " public-switches off, public-entities off");
    assertThat(Explanations.flagName(ClaimFlag.PUBLIC_SWITCHES)).isEqualTo("public-switches");
  }

  @Test
  void everyMembershipProblemReads() {
    var problems =
        List.of(
            new TownProblem.NoSuchTown("Atlantis"),
            new TownProblem.NotInvited("Aegis"),
            new TownProblem.OwnerCannotLeave(),
            new TownProblem.NotAMember("Bob"),
            new TownProblem.CannotManageMembers(TownRole.MEMBER),
            new TownProblem.Outranked("Bob"),
            new TownProblem.NotYourself(),
            new TownProblem.AlreadyRanked("Bob", TownRole.ASSISTANT),
            new TownProblem.TargetInTown("Bob"),
            new TownProblem.NoPendingTransfer());
    for (var problem : problems) {
      assertThat(Explanations.explain(problem)).as("%s", problem).isNotBlank().endsWith(".");
    }
    assertThat(Explanations.explain(new TownProblem.AlreadyRanked("Bob", TownRole.ASSISTANT)))
        .isEqualTo("Bob is an assistant, so that changes nothing.");
    assertThat(Explanations.explain(new TownProblem.NotInvited("Aegis")))
        .isEqualTo("You have no invitation from Aegis, or it has expired.");
  }

  @Test
  void everyClaimTrustProblemReads() {
    assertThat(
            Explanations.explain(new ClaimProblem.TrustsMember("Bob"), ExplanationsTest::bastion))
        .isEqualTo("Bob is in your town already; members build everywhere on its land.");
    assertThat(
            Explanations.explain(new ClaimProblem.AlreadyTrusted("Bob"), ExplanationsTest::bastion))
        .isEqualTo("Bob is already trusted here.");
    assertThat(Explanations.explain(new ClaimProblem.NotTrusted("Bob"), ExplanationsTest::bastion))
        .isEqualTo("Bob is not trusted here.");
  }

  @Test
  void everyLockProblemReads() {
    var problems =
        List.of(
            new LockProblem.NotLocked(),
            new LockProblem.AlreadyLocked(true),
            new LockProblem.AlreadyLocked(false),
            new LockProblem.PlacedBySomeoneElse(),
            new LockProblem.NotYourLand(),
            new LockProblem.LimitReached(64),
            new LockProblem.NotYourLock(),
            new LockProblem.NotYourself(),
            new LockProblem.AlreadyTrusted("Bob"),
            new LockProblem.NotTrusted("Bob"),
            new LockProblem.Busy());
    for (var problem : problems) {
      assertThat(Explanations.explain(problem)).as("%s", problem).isNotBlank().endsWith(".");
    }
    assertThat(Explanations.explain(new LockProblem.LimitReached(64)))
        .isEqualTo("You already hold 64 locks, the most you may. Unlock one first.");
  }

  @Test
  void pvpProblemsSayHowLongToWait() {
    var now = Instant.parse("2026-09-25T12:00:00Z");

    assertThat(Explanations.explain(new PvpProblem.TooSoon(now.plus(Duration.ofHours(75))), now))
        .isEqualTo("You changed your PvP recently; you can change it again in 3 days 3 hours.");
    assertThat(Explanations.explain(new PvpProblem.AlreadySet(false), now))
        .isEqualTo("Your PvP is already off.");
    assertThat(Explanations.explain(new PvpProblem.Busy(), now)).isNotBlank();
  }

  @Test
  void waitsRoundUpToTheMinute() {
    assertThat(Explanations.wait(Duration.ofSeconds(1))).isEqualTo("1 minute");
    assertThat(Explanations.wait(Duration.ZERO)).isEqualTo("1 minute");
    assertThat(Explanations.wait(Duration.ofSeconds(61))).isEqualTo("2 minutes");
    assertThat(Explanations.wait(Duration.ofMinutes(60))).isEqualTo("1 hour");
    assertThat(Explanations.wait(Duration.ofMinutes(125))).isEqualTo("2 hours 5 minutes");
    assertThat(Explanations.wait(Duration.ofDays(7))).isEqualTo("7 days");
    assertThat(Explanations.wait(Duration.ofDays(1).plusMinutes(30))).isEqualTo("1 day");
  }
}
