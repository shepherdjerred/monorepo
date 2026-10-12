// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/managers/LobbyManager.java and
// redwarfare-arcade/src/me/libraryaddict/arcade/game/Game.java, chooseKit); see
// packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.match;

import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitBook;
import com.shepherdjerred.thestorm.rwf.domain.map.MapDefinition;
import java.time.Instant;
import java.util.Optional;

/** Combatants arriving, picking kits and leaving. */
final class Roster {

  private Roster() {}

  static Optional<MatchError> join(Draft draft, MatchEvent.Join join) {
    if (draft.member(join.id()).isPresent()) {
      return Optional.of(MatchError.ALREADY_JOINED);
    }
    if (!draft.phase.preGame()) {
      return Optional.of(MatchError.IN_PROGRESS);
    }
    if (draft.members().size() >= draft.settings.maxPlayers()) {
      return Optional.of(MatchError.FULL);
    }
    draft.put(Combatant.joining(join.id(), join.name(), join.now()));
    draft.effect(new MatchEffect.CaptureSnapshot(join.id()));
    draft.effect(new MatchEffect.EnterLobby(join.id()));
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
      draft.depart(member.left(now));
      draft.effect(new MatchEffect.Restore(member.id()));
      draft.announce(Notice.of(NoticeKind.LEFT, "player", member.name()));
      Standings.check(draft, now);
      return;
    }
    draft.remove(member.id());
    draft.effect(new MatchEffect.Restore(member.id()));
    if (draft.phase.preGame()) {
      draft.announce(Notice.of(NoticeKind.LEFT, "player", member.name()));
    }
  }

  static Optional<MatchError> pickKit(Draft draft, MatchEvent.PickKit pick) {
    var member = draft.member(pick.id());
    if (member.isEmpty()) {
      return Optional.of(MatchError.NOT_A_MEMBER);
    }
    if (!draft.phase.preGame()) {
      return Optional.of(MatchError.NOT_PRE_GAME);
    }
    var kit = KitBook.byId(pick.kitId());
    if (kit.isEmpty()) {
      return Optional.of(MatchError.UNKNOWN_KIT);
    }
    draft.put(member.orElseThrow().withKit(pick.kitId()));
    draft.effect(new MatchEffect.Equip(pick.id(), pick.kitId()));
    draft.tell(pick.id(), Notice.of(NoticeKind.KIT_PICKED, "kit", kit.orElseThrow().name()));
    return Optional.empty();
  }

  static Optional<MatchError> mapChosen(Draft draft, MapDefinition map) {
    if (!draft.phase.preGame()) {
      return Optional.of(MatchError.MAP_LOCKED);
    }
    draft.map = Optional.of(map);
    return Optional.empty();
  }
}
