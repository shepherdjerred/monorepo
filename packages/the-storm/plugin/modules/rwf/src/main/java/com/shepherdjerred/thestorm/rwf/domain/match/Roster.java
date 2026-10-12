// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/managers/LobbyManager.java and
// redwarfare-arcade/src/me/libraryaddict/arcade/game/Game.java, chooseKit); see
// packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.match;

import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitBook;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

/** Combatants arriving, picking kits, being placed on teams and leaving. */
final class Roster {

  private Roster() {}

  static Optional<MatchError> join(Draft draft, MatchEvent.Join join) {
    if (draft.member(join.id()).isPresent()) {
      return Optional.of(MatchError.ALREADY_JOINED);
    }
    if (!draft.phase.admits()) {
      return Optional.of(MatchError.IN_PROGRESS);
    }
    if (draft.members().size() >= draft.settings.maxPlayers()) {
      return Optional.of(MatchError.FULL);
    }
    draft.put(Combatant.joining(join.id(), join.name(), join.now()));
    draft.effect(new MatchEffect.CaptureSnapshot(join.id()));
    draft.effect(new MatchEffect.EnterLobby(join.id()));
    if (draft.phase instanceof Phase.Preview) {
      draft.effect(new MatchEffect.PreviewMap(List.of(join.id()), draft.map().spectatorPoint()));
    }
    draft.announce(Notice.of(NoticeKind.JOINED, "player", join.name()));
    return Optional.empty();
  }

  static Optional<MatchError> leave(Draft draft, CombatantId id, Instant now) {
    var member = draft.member(id);
    if (member.isEmpty()) {
      return Optional.of(MatchError.NOT_A_MEMBER);
    }
    depart(draft, member.orElseThrow(), now);
    return Optional.empty();
  }

  /** A disconnect is a leave that cannot be refused. */
  static void disconnect(Draft draft, CombatantId id, Instant now) {
    draft.member(id).ifPresent(member -> depart(draft, member, now));
  }

  private static void depart(Draft draft, Combatant member, Instant now) {
    if (draft.phase instanceof Phase.Live) {
      draft.depart(member.left(now, true));
      draft.effect(new MatchEffect.Restore(member.id()));
      draft.announce(Notice.of(NoticeKind.LEFT, "player", member.name()));
      Standings.check(draft, now);
      return;
    }
    Voting.withdraw(draft, member.id());
    draft.remove(member.id());
    draft.effect(new MatchEffect.Restore(member.id()));
    if (draft.phase.admits() || draft.phase instanceof Phase.Freeze) {
      draft.announce(Notice.of(NoticeKind.LEFT, "player", member.name()));
    }
  }

  /**
   * {@code id} picks {@code kitId}: while kits are open, or for an operator at any point until the
   * match goes live (the kit is given at once once teams are dealt).
   */
  static Optional<MatchError> pickKit(Draft draft, CombatantId id, String kitId, boolean forced) {
    var member = draft.member(id);
    if (member.isEmpty()) {
      return Optional.of(MatchError.NOT_A_MEMBER);
    }
    var open = draft.phase.kitsOpen() || (forced && draft.phase instanceof Phase.Freeze);
    if (!open) {
      return Optional.of(MatchError.NOT_PRE_GAME);
    }
    var kit = KitBook.byId(kitId);
    if (kit.isEmpty()) {
      return Optional.of(MatchError.UNKNOWN_KIT);
    }
    var current = member.orElseThrow();
    if (draft.phase instanceof Phase.Freeze) {
      draft.put(current.withKit(kitId).withFuseOrNone(kit.orElseThrow().fuseBonus()));
    } else {
      draft.put(current.withKit(kitId));
    }
    draft.effect(new MatchEffect.Equip(id, kitId));
    draft.tell(id, Notice.of(NoticeKind.KIT_PICKED, "kit", kit.orElseThrow().name()));
    return Optional.empty();
  }

  /** An operator places {@code id} on {@code team} for when the teams are dealt. */
  static Optional<MatchError> assignTeam(Draft draft, CombatantId id, TeamColor team) {
    if (draft.member(id).isEmpty()) {
      return Optional.of(MatchError.NOT_A_MEMBER);
    }
    if (!draft.phase.admits()) {
      return Optional.of(MatchError.NOT_PRE_GAME);
    }
    if (draft.map.isPresent() && !draft.map().teamColors().contains(team)) {
      return Optional.of(MatchError.UNKNOWN_TEAM);
    }
    draft.pinned.put(id, team);
    return Optional.empty();
  }
}
