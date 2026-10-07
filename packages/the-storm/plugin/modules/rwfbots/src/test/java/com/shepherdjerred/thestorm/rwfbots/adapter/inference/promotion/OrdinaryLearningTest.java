package com.shepherdjerred.thestorm.rwfbots.adapter.inference.promotion;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import com.shepherdjerred.thestorm.rwf.domain.match.Outcome;
import com.shepherdjerred.thestorm.rwfbots.FakeMatch;
import com.shepherdjerred.thestorm.rwfbots.RwfBotsHarness;
import com.shepherdjerred.thestorm.rwfbots.adapter.db.JooqPersonalityStatsStore;
import com.shepherdjerred.thestorm.rwfbots.app.learning.MatchLearning;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Locale;
import org.bukkit.Location;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * Synthetic codec/JNI wiring only; these assertions provide no human-pilot or preference evidence.
 */
final class OrdinaryLearningTest {
  @Test
  void ordinaryPaperWiringUsesOneAcceptedActorWithoutChangingProfilesKitsOrRatings(
      @TempDir Path directory) throws Exception {
    var data = directory.resolve("server");
    var model = Files.createDirectories(data.resolve("rwfbots/learning/accepted/trooper"));
    var fixture = new PromotionFixture(model);
    assertThat(fixture.actor).isNotEmpty();
    try (var harness =
        RwfBotsHarness.start(data, config -> config, h -> h.learningFlag.set(true))) {
      var human = harness.server.addPlayer("Alice");
      // Start the target directly ahead in clear sight; seeing it must not depend on wandering.
      human.teleport(new Location(harness.world, 6.5, 1, 8.5));
      harness.match.fireJoin(new CombatantId.Human(human.getUniqueId()), human.getName());
      harness.match.fireMapChosen();
      var bots = harness.roster().fill(FakeMatch.MATCH_ID, 2);
      assertThat(bots).hasSize(2);
      for (var bot : bots) {
        harness.roster().spawn(bot, new Location(harness.world, 6.5, 1, 6.5));
        var entity = harness.roster().entity(bot).orElseThrow();
        harness.match.fireJoin(bot, entity.getName());
        var kit = bot.equals(bots.getFirst()) ? "trooper" : "longbow";
        harness.match.fighting(bot.uuid(), TeamColor.RED, kit);
        entity.setRotation(0, 0);
        entity.getInventory().setHeldItemSlot(1);
      }
      harness.match.fighting(human.getUniqueId(), TeamColor.BLUE, "trooper");
      harness.match.phase(MatchSnapshot.PhaseKind.LIVE);
      harness.match.fireTick();
      harness.ticks(60);
      assertThat(harness.paper().learningMetrics().state()).isEqualTo(MatchLearning.State.ON);
      var inference = harness.paper().learningMetrics().inference().orElseThrow();
      assertThat(inference.maximumBatch()).isEqualTo(1);
      assertThat(inference.submitted()).isPositive();
      assertThat(harness.paper().learningMetrics().applied())
          .as("learned actions applied: %s", harness.paper().learningMetrics())
          .isPositive();
      assertThat(harness.paper().roster().harness().active(FakeMatch.MATCH_ID)).isFalse();
      for (var bot : harness.paper().roster().live()) {
        var profile = bot.profile().orElseThrow();
        assertThat(profile.levers()).isEqualTo(bot.drafted().levers());
        assertThat(profile.kit().name().toLowerCase(Locale.ROOT))
            .isEqualTo(harness.match.member(bot.uuid()).kit().orElseThrow());
      }
      harness.learningFlag.set(false);
      harness.ticks(5);
      assertThat(harness.learningEvaluations).hasValue(1);
      assertThat(harness.paper().learningMetrics().state()).isEqualTo(MatchLearning.State.ON);
      harness.match.phase(MatchSnapshot.PhaseKind.ENDED);
      harness.match.outcome(new Outcome.Winner(TeamColor.RED));
      harness.match.fireTick();
      assertThat(harness.paper().learningMetrics().state()).isEqualTo(MatchLearning.State.IDLE);
      var records = new JooqPersonalityStatsStore(harness.database).loadAll().join();
      assertThat(records)
          .hasSize(2)
          .allMatch(record -> record.matches() == 1 && record.wins() == 1);
    }
  }
}
