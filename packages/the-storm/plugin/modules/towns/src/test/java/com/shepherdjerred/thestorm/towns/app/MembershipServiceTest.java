package com.shepherdjerred.thestorm.towns.app;

import static com.shepherdjerred.thestorm.towns.domain.Fixtures.ASSISTANT;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.MEMBER;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.NOMAD;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.OTHER_TOWN_OWNER;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.OWNER;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.TOWN_A;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.claim;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.towns.domain.Fixtures;
import com.shepherdjerred.thestorm.towns.domain.claiming.ClaimLimits;
import com.shepherdjerred.thestorm.towns.domain.region.RegionIndex;
import com.shepherdjerred.thestorm.towns.domain.town.MembershipPolicy;
import com.shepherdjerred.thestorm.towns.domain.town.PlayerRef;
import com.shepherdjerred.thestorm.towns.domain.town.Town;
import com.shepherdjerred.thestorm.towns.domain.town.TownProblem;
import com.shepherdjerred.thestorm.towns.domain.town.TownRole;
import java.time.Duration;
import java.time.Instant;
import java.time.InstantSource;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.OptionalInt;
import java.util.SplittableRandom;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Joining, leaving, ranks, handovers and renames against a store the test completes by hand, with a
 * clock the test moves, so expiry and saving are both visible.
 */
final class MembershipServiceTest {

  private static final PlayerRef NOMAD_REF = new PlayerRef(NOMAD, "Nomad");
  private static final PlayerRef MEMBER_REF = new PlayerRef(MEMBER, "Member");
  private static final PlayerRef ASSISTANT_REF = new PlayerRef(ASSISTANT, "Assistant");
  private static final PlayerRef OWNER_REF = new PlayerRef(OWNER, "Owner");

  private final MutableClock clock = new MutableClock(Instant.parse("2026-09-25T12:00:00Z"));
  private final FakeTownsStore store = new FakeTownsStore();
  private final TownsState state = new TownsState(new RegionIndex(List.of()));
  private final Map<UUID, Integer> online = new HashMap<>();
  private final List<UUID> redrawn = new ArrayList<>();
  private final List<UUID> departed = new ArrayList<>();
  private final Settling settling =
      new Settling(
          state,
          store,
          new Clocks(clock, new SplittableRandom(1), Runnable::run, failure -> {}),
          new TownEvents() {
            @Override
            public void landChanged(UUID townId) {
              redrawn.add(townId);
            }

            @Override
            public void removed(UUID townId) {
              redrawn.add(townId);
            }

            @Override
            public void reloaded() {
              // Nothing to redraw in these tests.
            }
          });
  private final MembershipService members =
      new MembershipService(
          settling,
          new MembershipPolicy(60, 30),
          new MembershipService.Hooks(
              player ->
                  online.containsKey(player)
                      ? OptionalInt.of(online.get(player))
                      : OptionalInt.empty(),
              ClaimLimits.flat(10),
              (townId, player, lockIds) -> departed.add(player)));

  @BeforeEach
  void load() {
    store.seed(Fixtures.townA(), claim(TOWN_A, 0, 0));
    store.seed(Fixtures.townB());
    state.load(store.snapshot());
  }

  private static <T> T ok(Result<T, List<TownProblem>> result) {
    return result.fold(
        value -> value,
        problems -> {
          throw new AssertionError("expected success, got " + problems);
        });
  }

  private static List<TownProblem> problems(Result<?, List<TownProblem>> result) {
    return result.fold(
        value -> {
          throw new AssertionError("expected problems, got " + value);
        },
        problems -> problems);
  }

  @Test
  void anInvitedPlayerJoinsAsAMember() {
    ok(members.invite(ASSISTANT, NOMAD_REF));
    assertThat(members.invitationsFor(NOMAD)).extracting(Town::name).containsExactly("Aegis");

    var joined = ok(members.accept(NOMAD, "aegis")).value();
    store.succeed();

    assertThat(joined.roleOf(NOMAD)).contains(TownRole.MEMBER);
    assertThat(state.townOf(NOMAD)).contains(joined);
    assertThat(store.snapshot().towns()).contains(joined);
    assertThat(members.invitationsFor(NOMAD)).isEmpty();
  }

  @Test
  void failedJoinKeepsInvitationForRetry() {
    ok(members.invite(ASSISTANT, NOMAD_REF));

    ok(members.accept(NOMAD, "Aegis"));
    assertThat(members.invitationsFor(NOMAD)).extracting(Town::name).containsExactly("Aegis");
    store.fail();

    assertThat(state.townOf(NOMAD)).isEmpty();
    assertThat(members.invitationsFor(NOMAD)).extracting(Town::name).containsExactly("Aegis");
    ok(members.accept(NOMAD, "Aegis"));
    store.succeed();
    assertThat(members.invitationsFor(NOMAD)).isEmpty();
    assertThat(state.townOf(NOMAD)).isPresent();
  }

  @Test
  void anUninvitedOrExpiredPlayerCannotJoin() {
    assertThat(problems(members.accept(NOMAD, "Aegis")))
        .containsExactly(new TownProblem.NotInvited("Aegis"));

    ok(members.invite(OWNER, NOMAD_REF));
    clock.advance(Duration.ofMinutes(61));

    assertThat(problems(members.accept(NOMAD, "Aegis")))
        .containsExactly(new TownProblem.NotInvited("Aegis"));
    assertThat(members.invitationsFor(NOMAD)).isEmpty();
  }

  @Test
  void aDeniedInvitationIsGone() {
    ok(members.invite(OWNER, NOMAD_REF));

    assertThat(ok(members.deny(NOMAD, "Aegis")).name()).isEqualTo("Aegis");
    assertThat(problems(members.accept(NOMAD, "Aegis")))
        .containsExactly(new TownProblem.NotInvited("Aegis"));
    assertThat(problems(members.deny(NOMAD, "Aegis")))
        .containsExactly(new TownProblem.NotInvited("Aegis"));
    assertThat(problems(members.deny(NOMAD, "Atlantis")))
        .containsExactly(new TownProblem.NoSuchTown("Atlantis"));
  }

  @Test
  void membersCannotInviteAndNobodyInvitesATownsman() {
    assertThat(problems(members.invite(MEMBER, NOMAD_REF)))
        .containsExactly(new TownProblem.CannotManageMembers(TownRole.MEMBER));
    assertThat(problems(members.invite(OWNER, new PlayerRef(OTHER_TOWN_OWNER, "Other"))))
        .containsExactly(new TownProblem.TargetInTown("Other"));
    assertThat(problems(members.invite(NOMAD, OWNER_REF)))
        .containsExactly(new TownProblem.NotInTown());
  }

  @Test
  void membersLeaveButOwnersCannot() {
    var left = ok(members.leave(MEMBER)).value();
    store.succeed();

    assertThat(left.roleOf(MEMBER)).isEmpty();
    assertThat(state.townOf(MEMBER)).isEmpty();
    assertThat(departed).containsExactly(MEMBER);
    assertThat(problems(members.leave(OWNER))).containsExactly(new TownProblem.OwnerCannotLeave());
  }

  @Test
  void kicksFollowRank() {
    assertThat(problems(members.kick(ASSISTANT, OWNER_REF)))
        .containsExactly(new TownProblem.Outranked("Owner"));
    assertThat(problems(members.kick(MEMBER, NOMAD_REF)))
        .containsExactly(new TownProblem.CannotManageMembers(TownRole.MEMBER));

    ok(members.kick(ASSISTANT, MEMBER_REF));
    store.succeed();
    assertThat(state.townOf(MEMBER)).isEmpty();
    assertThat(departed).containsExactly(MEMBER);

    ok(members.kick(OWNER, ASSISTANT_REF));
    store.succeed();
    assertThat(state.townOf(ASSISTANT)).isEmpty();
  }

  @Test
  void aFailedKickIsUndone() {
    ok(members.kick(OWNER, MEMBER_REF));
    assertThat(state.townOf(MEMBER)).isEmpty();
    assertThat(departed).isEmpty();

    store.fail();

    assertThat(state.townOf(MEMBER)).contains(Fixtures.townA());
    assertThat(departed).isEmpty();
  }

  @Test
  void aTownBeingSavedTakesNoOtherMembershipChange() {
    ok(members.kick(OWNER, MEMBER_REF));

    assertThat(problems(members.promote(OWNER, ASSISTANT_REF)))
        .containsExactly(new TownProblem.Busy());
    store.succeed();
    assertThat(problems(members.promote(OWNER, ASSISTANT_REF)))
        .containsExactly(new TownProblem.AlreadyRanked("Assistant", TownRole.ASSISTANT));
  }

  @Test
  void onlyTheOwnerPromotesAndDemotes() {
    assertThat(problems(members.promote(ASSISTANT, MEMBER_REF)))
        .containsExactly(new TownProblem.NotOwner(TownRole.ASSISTANT));

    ok(members.promote(OWNER, MEMBER_REF));
    store.succeed();
    assertThat(state.townOf(MEMBER).orElseThrow().roleOf(MEMBER)).contains(TownRole.ASSISTANT);

    ok(members.demote(OWNER, MEMBER_REF));
    store.succeed();
    assertThat(state.townOf(MEMBER).orElseThrow().roleOf(MEMBER)).contains(TownRole.MEMBER);
    assertThat(problems(members.demote(OWNER, MEMBER_REF)))
        .containsExactly(new TownProblem.AlreadyRanked("Member", TownRole.MEMBER));
  }

  @Test
  void aHandoverTakesAConfirmationInTime() {
    assertThat(problems(members.confirmTransfer(OWNER)))
        .containsExactly(new TownProblem.NoPendingTransfer());

    ok(members.requestTransfer(OWNER, MEMBER_REF));
    online.put(MEMBER, 4);
    clock.advance(Duration.ofSeconds(31));
    assertThat(problems(members.confirmTransfer(OWNER)))
        .containsExactly(new TownProblem.NoPendingTransfer());

    ok(members.requestTransfer(OWNER, MEMBER_REF));
    var town = ok(members.confirmTransfer(OWNER)).value();
    store.succeed();

    assertThat(town.owner()).isEqualTo(MEMBER);
    assertThat(town.roleOf(OWNER)).contains(TownRole.ASSISTANT);
    assertThat(town.governorLevel()).isEqualTo(4);
    assertThat(store.snapshot().towns()).contains(town);
  }

  @Test
  void anOfflineNewOwnerCannotTakeTheTownAndMayRetryWhenOnline() {
    state.replaceTown(Fixtures.townA().withGovernorLevel(5));
    ok(members.requestTransfer(OWNER, MEMBER_REF));

    assertThat(problems(members.confirmTransfer(OWNER)))
        .containsExactly(new TownProblem.TargetOffline("Member"));
    online.put(MEMBER, 1);
    var town = ok(members.confirmTransfer(OWNER)).value();
    assertThat(town.governorLevel()).isEqualTo(1);
  }

  @Test
  void onlyTheOwnerHandsOverAndOnlyToAMember() {
    assertThat(problems(members.requestTransfer(ASSISTANT, MEMBER_REF)))
        .containsExactly(new TownProblem.NotOwner(TownRole.ASSISTANT));
    assertThat(problems(members.requestTransfer(OWNER, NOMAD_REF)))
        .containsExactly(new TownProblem.NotAMember("Nomad"));
    assertThat(problems(members.requestTransfer(OWNER, OWNER_REF)))
        .containsExactly(new TownProblem.NotYourself());
  }

  @Test
  void aRenameIsCheckedSavedAndRedrawn() {
    assertThat(problems(members.rename(ASSISTANT, "Arcadia")))
        .containsExactly(new TownProblem.NotOwner(TownRole.ASSISTANT));
    assertThat(problems(members.rename(OWNER, "bastion")))
        .containsExactly(new TownProblem.NameTaken("bastion"));
    assertThat(problems(members.rename(OWNER, "no way")))
        .containsExactly(new TownProblem.InvalidName("no way"));

    ok(members.rename(OWNER, "Arcadia"));
    store.succeed();

    assertThat(state.named("arcadia")).isPresent();
    assertThat(state.named("aegis")).isEmpty();
    assertThat(redrawn).containsExactly(TOWN_A);
    ok(members.rename(OWNER, "ARCADIA"));
  }

  @Test
  void aDeletedTownsInvitationsAreForgotten() {
    ok(members.invite(OWNER, NOMAD_REF));

    members.forgetTown(TOWN_A);

    assertThat(members.invitationsFor(NOMAD)).isEmpty();
  }

  /** A clock the test moves forward. */
  static final class MutableClock implements InstantSource {

    private Instant now;

    MutableClock(Instant start) {
      now = start;
    }

    void advance(Duration duration) {
      now = now.plus(duration);
    }

    @Override
    public Instant instant() {
      return now;
    }
  }
}
