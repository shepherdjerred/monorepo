package com.shepherdjerred.thestorm.towns.domain.town;

import static com.shepherdjerred.thestorm.towns.domain.Fixtures.ASSISTANT;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.MEMBER;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.NOMAD;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.OTHER_TOWN_OWNER;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.OWNER;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.towns.domain.Fixtures;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

/** Who may invite, join, leave, kick, rank, hand over and rename, rank by rank. */
final class MembershipTest {

  private static final PlayerRef OWNER_REF = new PlayerRef(OWNER, "Owner");
  private static final PlayerRef ASSISTANT_REF = new PlayerRef(ASSISTANT, "Assistant");
  private static final PlayerRef MEMBER_REF = new PlayerRef(MEMBER, "Member");
  private static final PlayerRef NOMAD_REF = new PlayerRef(NOMAD, "Nomad");
  private static final PlayerRef OTHER_REF = new PlayerRef(OTHER_TOWN_OWNER, "Other");

  /** A second assistant and member of town A, so everyone can act on someone of every rank. */
  private static final UUID ASSISTANT_2 = UUID.fromString("00000000-0000-4000-8000-000000000012");

  private static final UUID MEMBER_2 = UUID.fromString("00000000-0000-4000-8000-000000000013");

  private final Town aegis =
      Fixtures.townA()
          .withMember(ASSISTANT_2, TownRole.ASSISTANT)
          .withMember(MEMBER_2, TownRole.MEMBER);

  private final TownDirectory towns =
      new TownDirectory() {
        @Override
        public Optional<Town> townOf(UUID player) {
          return Stream.of(aegis, Fixtures.townB())
              .filter(town -> town.roleOf(player).isPresent())
              .findFirst();
        }

        @Override
        public Optional<Town> named(String name) {
          return Stream.of(aegis, Fixtures.townB())
              .filter(town -> town.name().equalsIgnoreCase(name))
              .findFirst();
        }
      };

  private static Optional<TownRole> roleIn(Result<Town, List<TownProblem>> result, UUID player) {
    return result.fold(town -> town.roleOf(player), problems -> Optional.<TownRole>empty());
  }

  private static List<TownProblem> problems(Result<Town, List<TownProblem>> result) {
    return result.fold(town -> List.of(), problems -> problems);
  }

  /** Every actor rank against every target rank: owners remove anyone, assistants only members. */
  static Stream<Arguments> kicks() {
    return Stream.of(
        Arguments.of(OWNER, ASSISTANT_2, true),
        Arguments.of(OWNER, MEMBER_2, true),
        Arguments.of(ASSISTANT, OWNER, false),
        Arguments.of(ASSISTANT, ASSISTANT_2, false),
        Arguments.of(ASSISTANT, MEMBER_2, true),
        Arguments.of(MEMBER, OWNER, false),
        Arguments.of(MEMBER, ASSISTANT_2, false),
        Arguments.of(MEMBER, MEMBER_2, false));
  }

  @ParameterizedTest(name = "{0} kicks {1}: {2}")
  @MethodSource("kicks")
  void kicksFollowRank(UUID actor, UUID target, boolean allowed) {
    var result = Membership.kick(actor, new PlayerRef(target, "Target"), towns);

    assertThat(result.isOk()).isEqualTo(allowed);
    if (allowed) {
      assertThat(roleIn(result, target)).isEmpty();
    }
  }

  @Test
  void rankOrderIsStrict() {
    for (var actor : TownRole.values()) {
      assertThat(actor.outranks(TownRole.OWNER)).isFalse();
      assertThat(actor.outranks(actor)).isFalse();
    }
    assertThat(TownRole.OWNER.outranks(TownRole.ASSISTANT)).isTrue();
    assertThat(TownRole.ASSISTANT.outranks(TownRole.MEMBER)).isTrue();
    assertThat(TownRole.MEMBER.outranks(TownRole.MEMBER)).isFalse();
    assertThat(TownRole.OWNER.manages()).isTrue();
    assertThat(TownRole.ASSISTANT.manages()).isTrue();
    assertThat(TownRole.MEMBER.manages()).isFalse();
  }

  @Test
  void kickingNeedsATargetInTheTownWhoIsNotYou() {
    assertThat(problems(Membership.kick(OWNER, NOMAD_REF, towns)))
        .containsExactly(new TownProblem.NotAMember("Nomad"));
    assertThat(problems(Membership.kick(OWNER, OTHER_REF, towns)))
        .containsExactly(new TownProblem.NotAMember("Other"));
    assertThat(problems(Membership.kick(OWNER, OWNER_REF, towns)))
        .containsExactly(new TownProblem.NotYourself());
    assertThat(problems(Membership.kick(MEMBER, NOMAD_REF, towns)))
        .containsExactly(new TownProblem.CannotManageMembers(TownRole.MEMBER));
    assertThat(problems(Membership.kick(NOMAD, MEMBER_REF, towns)))
        .containsExactly(new TownProblem.NotInTown());
  }

  @Test
  void ownersAndAssistantsInviteAnyoneWithoutATown() {
    assertThat(Membership.invite(OWNER, NOMAD_REF, towns).isOk()).isTrue();
    assertThat(Membership.invite(ASSISTANT, NOMAD_REF, towns).isOk()).isTrue();
    assertThat(problems(Membership.invite(MEMBER, NOMAD_REF, towns)))
        .containsExactly(new TownProblem.CannotManageMembers(TownRole.MEMBER));
    assertThat(problems(Membership.invite(OWNER, OTHER_REF, towns)))
        .containsExactly(new TownProblem.TargetInTown("Other"));
    assertThat(problems(Membership.invite(OWNER, OWNER_REF, towns)))
        .containsExactly(new TownProblem.NotYourself());
  }

  @Test
  void joiningNeedsAnInvitationAndNoTown() {
    var joined = Membership.join(NOMAD, aegis, true, towns);
    assertThat(roleIn(joined, NOMAD)).contains(TownRole.MEMBER);
    assertThat(problems(Membership.join(NOMAD, aegis, false, towns)))
        .containsExactly(new TownProblem.NotInvited("Aegis"));
    assertThat(problems(Membership.join(OTHER_TOWN_OWNER, aegis, true, towns)))
        .containsExactly(new TownProblem.AlreadyInTown("Bastion"));
  }

  @Test
  void everyoneButTheOwnerMayLeave() {
    assertThat(Membership.leave(MEMBER, towns).isOk()).isTrue();
    assertThat(Membership.leave(ASSISTANT, towns).isOk()).isTrue();
    assertThat(problems(Membership.leave(OWNER, towns)))
        .containsExactly(new TownProblem.OwnerCannotLeave());
    assertThat(problems(Membership.leave(NOMAD, towns)))
        .containsExactly(new TownProblem.NotInTown());
  }

  @Test
  void onlyTheOwnerRanksMembersOneStepAtATime() {
    var promoted = Membership.promote(OWNER, MEMBER_REF, towns);
    assertThat(roleIn(promoted, MEMBER)).contains(TownRole.ASSISTANT);
    var demoted = Membership.demote(OWNER, ASSISTANT_REF, towns);
    assertThat(roleIn(demoted, ASSISTANT)).contains(TownRole.MEMBER);

    assertThat(problems(Membership.promote(OWNER, ASSISTANT_REF, towns)))
        .containsExactly(new TownProblem.AlreadyRanked("Assistant", TownRole.ASSISTANT));
    assertThat(problems(Membership.demote(OWNER, MEMBER_REF, towns)))
        .containsExactly(new TownProblem.AlreadyRanked("Member", TownRole.MEMBER));
    assertThat(problems(Membership.promote(ASSISTANT, MEMBER_REF, towns)))
        .containsExactly(new TownProblem.NotOwner(TownRole.ASSISTANT));
    assertThat(problems(Membership.promote(OWNER, NOMAD_REF, towns)))
        .containsExactly(new TownProblem.NotAMember("Nomad"));
    assertThat(problems(Membership.demote(OWNER, OWNER_REF, towns)))
        .containsExactly(new TownProblem.NotYourself());
  }

  @Test
  void aHandoverKeepsTheOldOwnerAsAnAssistant() {
    var town =
        Membership.transfer(OWNER, MEMBER_REF, new Membership.Successor(true, 3, 4, 1), towns)
            .fold(
                handed -> handed,
                problems -> {
                  throw new AssertionError(problems);
                });

    assertThat(town.owner()).isEqualTo(MEMBER);
    assertThat(town.roleOf(OWNER)).contains(TownRole.ASSISTANT);
    assertThat(town.governorLevel()).isEqualTo(3);
    assertThat(town.members()).hasSize(aegis.members().size());
    assertThat(
            problems(
                Membership.transfer(
                    ASSISTANT, MEMBER_REF, new Membership.Successor(true, 3, 4, 1), towns)))
        .containsExactly(new TownProblem.NotOwner(TownRole.ASSISTANT));
  }

  @Test
  void aHandoverNeedsAnOnlineQualifiedOwnerWhoCanHoldTheLand() {
    assertThat(
            problems(
                Membership.transfer(
                    OWNER, MEMBER_REF, new Membership.Successor(false, 0, 4, 1), towns)))
        .containsExactly(new TownProblem.TargetOffline("Member"));
    assertThat(
            problems(
                Membership.transfer(
                    OWNER, MEMBER_REF, new Membership.Successor(true, 0, 4, 1), towns)))
        .containsExactly(new TownProblem.NotAGovernor("Member"));
    assertThat(
            problems(
                Membership.transfer(
                    OWNER, MEMBER_REF, new Membership.Successor(true, 1, 0, 1), towns)))
        .containsExactly(new TownProblem.TooMuchLand("Member", 1, 0));
  }

  @Test
  void renamingChecksTheNameButAllowsANewCase() {
    assertThat(Membership.rename(OWNER, "AEGIS", towns).isOk()).isTrue();
    assertThat(Membership.rename(OWNER, "Arcadia", towns).isOk()).isTrue();
    assertThat(problems(Membership.rename(OWNER, "Bastion", towns)))
        .containsExactly(new TownProblem.NameTaken("Bastion"));
    assertThat(problems(Membership.rename(OWNER, "x", towns)))
        .containsExactly(new TownProblem.InvalidName("x"));
    assertThat(problems(Membership.rename(MEMBER, "Arcadia", towns)))
        .containsExactly(new TownProblem.NotOwner(TownRole.MEMBER));
  }

  @Test
  void townsTransitionImmutably() {
    var before = Map.copyOf(aegis.members());

    var _ = aegis.withoutMember(MEMBER).renamed("Other").withGovernorLevel(5);

    assertThat(aegis.members()).isEqualTo(before);
    assertThat(aegis.name()).isEqualTo("Aegis");
  }
}
