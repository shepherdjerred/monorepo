package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.core.analytics.GameActivity;
import com.shepherdjerred.thestorm.rwf.app.MatchNotification;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEffect;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import java.util.List;
import java.util.UUID;

/** Observes accepted transitions, excluding bot identities. */
final class MatchAnalytics {
  private final GameActivity activity;
  private MatchSnapshot.PhaseKind phase = MatchSnapshot.PhaseKind.LOBBY;
  private List<UUID> participants = List.of();

  MatchAnalytics(GameActivity activity) {
    this.activity = activity;
  }

  void accept(MatchNotification notification) {
    var after = notification.after();
    for (var effect : notification.effects()) {
      if (effect instanceof MatchEffect.EnterLobby(var id)
          && id instanceof CombatantId.Human human) {
        activity.joined(human.uuid());
      }
    }
    var humans =
        after.combatants().stream()
            .map(MatchSnapshot.CombatantView::id)
            .filter(CombatantId.Human.class::isInstance)
            .map(CombatantId::uuid)
            .toList();
    if (phase != MatchSnapshot.PhaseKind.LIVE && after.phase() == MatchSnapshot.PhaseKind.LIVE)
      activity.started(humans);
    if (phase == MatchSnapshot.PhaseKind.LIVE
        && (after.phase() == MatchSnapshot.PhaseKind.ENDED
            || after.phase() == MatchSnapshot.PhaseKind.RESETTING))
      activity.completed(participants);
    for (var effect : notification.effects()) {
      if (effect instanceof MatchEffect.Restore(var id) && id instanceof CombatantId.Human human)
        activity.left(human.uuid());
    }
    phase = after.phase();
    participants = humans;
  }
}
