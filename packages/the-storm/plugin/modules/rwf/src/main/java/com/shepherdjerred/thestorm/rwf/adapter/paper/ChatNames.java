// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/abilities/SpyAbility.java,
// onChat); see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.chat.app.NameColors;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Spy;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.match.Phase;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import net.kyori.adventure.text.format.NamedTextColor;

/**
 * Chat names in team colours, as Red Warfare's Spy ability coloured them while a Spy was in the
 * live game: every fighter's name in their team's colour, and a Spy's in each listener's own team
 * colour, so the enemy reads them as one of their own (a listener with no team sees the Spy's real
 * colour). With no Spy, or before or after the live game, names are left as they are.
 *
 * <p>Chat asks from its async threads, so the teams are kept as an immutable view the main thread
 * replaces after every match change.
 */
final class ChatNames implements NameColors {

  /**
   * Who is on which team, while a Spy is in the live game.
   *
   * @param teams each fighter's team, by entity UUID
   * @param spies the fighters playing the Spy
   */
  record View(Map<UUID, TeamColor> teams, Set<UUID> spies) {

    static final View OFF = new View(Map.of(), Set.of());

    View {
      teams = Map.copyOf(teams);
      spies = Set.copyOf(spies);
    }
  }

  private final MatchRunner runner;
  private volatile View view = View.OFF;

  ChatNames(MatchRunner runner) {
    this.runner = runner;
  }

  /** Rebuilds the view from the match; main thread, after every match change. */
  void refresh() {
    var match = runner.match();
    if (!(match.phase() instanceof Phase.Live)) {
      view = View.OFF;
      return;
    }
    var teams = new HashMap<UUID, TeamColor>();
    var spies = new HashSet<UUID>();
    for (var member : match.members()) {
      member.team().ifPresent(team -> teams.put(member.id().uuid(), team));
      if (member.kit().filter(Spy.ID::equals).isPresent()) {
        spies.add(member.id().uuid());
      }
    }
    view = spies.isEmpty() ? View.OFF : new View(teams, spies);
  }

  @Override
  public Optional<String> color(UUID speaker, UUID viewer) {
    return color(view, speaker, viewer).map(ChatNames::name);
  }

  /** The team colour {@code speaker}'s name takes for {@code viewer} under {@code view}. */
  static Optional<TeamColor> color(View view, UUID speaker, UUID viewer) {
    var own = Optional.ofNullable(view.teams().get(speaker));
    if (own.isEmpty() || !view.spies().contains(speaker)) {
      return own;
    }
    return Optional.ofNullable(view.teams().get(viewer)).or(() -> own);
  }

  private static String name(TeamColor team) {
    var color = Scoreboards.color(team);
    var name = NamedTextColor.NAMES.key(color);
    if (name == null) {
      throw new IllegalStateException("team colours are named colours: " + color);
    }
    return name;
  }
}
