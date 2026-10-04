package com.shepherdjerred.thestorm.rwfbots.app;

import com.shepherdjerred.thestorm.rwfbots.domain.director.OpenSkill;
import com.shepherdjerred.thestorm.rwfbots.domain.director.Rating;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TeamId;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Turns a finished match into updated personality records: every team's ratings (humans at their
 * current rating, bots at theirs) go through one OpenSkill update, with the winning team ranked
 * first and everyone else tied behind it, or everyone tied for a draw.
 */
public final class MatchSettlement {

  private MatchSettlement() {}

  /**
   * One member of a team at the end.
   *
   * @param personalityId the personality, for a bot; empty for a human
   * @param rating the rating going in
   * @param tally what the bot did; {@link PersonalityStats.Tally#NONE} for humans
   */
  public record Member(
      Optional<String> personalityId, Rating rating, PersonalityStats.Tally tally) {}

  /**
   * The updated records of every bot in {@code teams}.
   *
   * @param teams each team's members, at least two teams with someone on each
   * @param winner the winning team, or empty for a draw or a stop
   * @param current the bots' records before the match, by personality id
   * @param now when the match ended
   */
  public static List<PersonalityStats> settle(
      Map<TeamId, List<Member>> teams,
      Optional<TeamId> winner,
      Map<String, PersonalityStats> current,
      Instant now) {
    var order = List.copyOf(teams.entrySet());
    var ratings = new ArrayList<List<Rating>>();
    var ranks = new ArrayList<Integer>();
    for (var team : order) {
      ratings.add(team.getValue().stream().map(Member::rating).toList());
      ranks.add(winner.isEmpty() || winner.orElseThrow().equals(team.getKey()) ? 0 : 1);
    }
    var rated = OpenSkill.rate(ratings, ranks);
    var updated = new ArrayList<PersonalityStats>();
    for (var t = 0; t < order.size(); t++) {
      var members = order.get(t).getValue();
      var won = winner.filter(order.get(t).getKey()::equals).isPresent();
      for (var m = 0; m < members.size(); m++) {
        var member = members.get(m);
        if (member.personalityId().isEmpty()) {
          continue;
        }
        var id = member.personalityId().orElseThrow();
        var before = current.get(id);
        if (before == null) {
          throw new IllegalArgumentException("no record for personality " + id);
        }
        updated.add(before.afterMatch(won, member.tally(), rated.get(t).get(m), now));
      }
    }
    return List.copyOf(updated);
  }
}
