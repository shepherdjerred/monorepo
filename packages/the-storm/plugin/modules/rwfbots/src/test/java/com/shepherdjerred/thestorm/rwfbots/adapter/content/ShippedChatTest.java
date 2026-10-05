package com.shepherdjerred.thestorm.rwfbots.adapter.content;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import com.shepherdjerred.thestorm.rwfbots.domain.chat.ChatDirector;
import com.shepherdjerred.thestorm.rwfbots.domain.chat.ChatMoment;
import com.shepherdjerred.thestorm.rwfbots.domain.chat.ChatScene;
import com.shepherdjerred.thestorm.rwfbots.domain.chat.ChatSettings;
import com.shepherdjerred.thestorm.rwfbots.domain.chat.Utterance;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Lines;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Personality;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.PersonalityCatalog;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.List;
import java.util.Optional;
import java.util.SplittableRandom;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * Every shipped personality speaks through the director under the shipped chat settings: lines come
 * out with every placeholder filled, within the length a chat line allows, and every moment is
 * reachable for the catalog as a whole.
 */
final class ShippedChatTest {

  private static final Instant T0 = Instant.parse("2026-10-04T12:00:00Z");

  private static Path property(String key) {
    var path = System.getProperty(key);
    assertThat(path).as("the build passes %s", key).isNotNull();
    return Path.of(path);
  }

  /** The shipped settings with every chance at 1 and no rate limit worth the name. */
  private static ChatSettings everything(ChatSettings shipped) {
    var chances = new EnumMap<Lines.Moment, Double>(Lines.Moment.class);
    for (var moment : Lines.Moment.values()) {
      chances.put(moment, 1.0);
    }
    return new ChatSettings(
        chances,
        shipped.verbosity(),
        shipped.rivalBoost(),
        Duration.ofMillis(1),
        Duration.ofMillis(1),
        1000,
        Duration.ofMillis(1),
        Duration.ZERO,
        Duration.ZERO,
        Duration.ofDays(1),
        shipped.recentDeath(),
        Duration.ofMillis(1));
  }

  @Test
  void everyShippedPersonalitySpeaksWithItsPlaceholdersFilled() {
    PersonalityCatalog catalog =
        PersonalityFiles.loadDirectory(property("thestorm.rwfbots.personalities"));
    var shipped =
        ConfigFiles.load(property("thestorm.rwfbots.config"), RwfBotsConfig.class)
            .chat()
            .toSettings();
    var settings = everything(shipped);
    var bots = catalog.active();
    assertThat(bots).isNotEmpty();

    var members = new ArrayList<ChatScene.Member>();
    var i = 0;
    for (Personality bot : bots) {
      members.add(
          new ChatScene.Member(
              new UUID(7, i),
              bot.name(),
              Optional.of(bot),
              Optional.of(i % 2 == 0 ? "Red Team" : "Blue Team"),
              true));
      i++;
    }
    var heard = EnumSet.noneOf(Lines.Moment.class);
    var lines = new ArrayList<Utterance>();
    for (var seed = 0; seed < 3; seed++) {
      var director = new ChatDirector(settings, new SplittableRandom(seed), T0);
      var now = T0;
      lines.addAll(director.on(new ChatMoment.Started(), new ChatScene(members), now));
      var alive = new ArrayList<>(members);
      for (var k = 0; k + 1 < members.size(); k++) {
        now = now.plusSeconds(1);
        var victim = members.get(k);
        var killer = members.get(k + 1);
        alive.set(k, dead(victim));
        lines.addAll(
            director.on(
                new ChatMoment.Died(victim.uuid(), Optional.of(killer.uuid())),
                new ChatScene(alive),
                now));
        lines.addAll(
            director.on(
                new ChatMoment.Planted(killer.uuid(), "Blue Team's bomb", false),
                new ChatScene(alive),
                now));
        lines.addAll(
            director.on(
                new ChatMoment.Defused(killer.uuid(), "the nuke"), new ChatScene(alive), now));
        lines.addAll(director.on(new ChatMoment.Idle(), new ChatScene(alive), now));
      }
      lines.addAll(
          director.on(
              new ChatMoment.Ended(Optional.of("Red Team")),
              new ChatScene(alive),
              now.plusSeconds(1)));
    }
    for (var line : lines) {
      heard.add(line.moment());
      assertThat(line.text())
          .as("%s's %s line", line.name(), line.moment())
          .doesNotContain("{", "}")
          .hasSizeLessThanOrEqualTo(256);
    }
    // A match speaks every pool but the lobby one, which belongs to the pre-match lobby.
    assertThat(heard)
        .containsExactlyInAnyOrderElementsOf(EnumSet.complementOf(EnumSet.of(Lines.Moment.LOBBY)));
  }

  private static ChatScene.Member dead(ChatScene.Member member) {
    return new ChatScene.Member(member.uuid(), member.name(), member.bot(), member.team(), false);
  }

  @Test
  void theShippedChatIsRateLimited() {
    var shipped =
        ConfigFiles.load(property("thestorm.rwfbots.config"), RwfBotsConfig.class)
            .chat()
            .toSettings();
    var catalog = PersonalityFiles.loadDirectory(property("thestorm.rwfbots.personalities"));
    var members = new ArrayList<ChatScene.Member>();
    var i = 0;
    for (var bot : catalog.active()) {
      members.add(
          new ChatScene.Member(
              new UUID(8, i), bot.name(), Optional.of(bot), Optional.of("Red Team"), true));
      i++;
    }
    for (var seed = 0; seed < 20; seed++) {
      var greets =
          new ChatDirector(shipped, new SplittableRandom(seed), T0)
              .on(new ChatMoment.Started(), new ChatScene(members), T0);
      assertThat(greets.size()).isLessThanOrEqualTo(shipped.maxLinesPerWindow());
      for (var k = 1; k < greets.size(); k++) {
        assertThat(Duration.between(greets.get(k - 1).at(), greets.get(k).at()))
            .isGreaterThanOrEqualTo(shipped.minGap());
      }
      assertThat(greets)
          .allSatisfy(line -> assertThat(line.at()).isBeforeOrEqualTo(T0.plus(shipped.maxDelay())));
    }
    assertThat(List.of(shipped.reactionMin(), shipped.reactionMax()))
        .allSatisfy(d -> assertThat(d).isLessThanOrEqualTo(shipped.maxDelay()));
  }
}
