package com.shepherdjerred.thestorm.rwfbots.domain.chat;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.Fixtures;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Lines;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Personality;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Voice;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Callout;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import java.util.List;
import java.util.Optional;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

/** Calls read like a player typing them, in the speaker's voice. */
final class CalloutLinesTest {

  private static Personality voiced(List<String> tones, String style) {
    var base = Fixtures.personality("caller", "Caller", 0.5);
    return new Personality(
        base.id(),
        base.name(),
        base.skinValue(),
        base.skinSignature(),
        base.skill(),
        base.archetype(),
        base.leverOffsets(),
        base.kits(),
        base.roles(),
        base.style(),
        new Voice(tones, Voice.Verbosity.NORMAL, style),
        base.lines(),
        base.quirks(),
        base.rivals(),
        base.bio(),
        base.batch(),
        base.retired());
  }

  private static Callout call(
      Callout.Kind kind, Optional<Integer> subject, Optional<String> bearing) {
    return new Callout(
        kind,
        new CombatantId(1),
        RED,
        new Vec3(55, 65, 31),
        "blue bomb",
        subject.map(CombatantId::new),
        bearing,
        0);
  }

  @Test
  void everyCallNamesItsPlaceOrItsHumanAndFitsAChatLine() {
    var random = new SplittableRandom(4);
    var plain = Optional.of(voiced(List.of("dry"), "short and dry"));
    for (var kind : Callout.Kind.values()) {
      for (var draw = 0; draw < 20; draw++) {
        var named = call(kind, Optional.of(50), Optional.of("behind you"));
        var line = CalloutLines.line(named, Optional.of("Jerred"), plain, random);
        assertThat(line)
            .as("%s", kind)
            .doesNotContain("{")
            .hasSizeLessThanOrEqualTo(Lines.MAX_LINE_LENGTH);
        var anonymous =
            CalloutLines.line(
                call(kind, Optional.empty(), Optional.empty()), Optional.empty(), plain, random);
        assertThat(anonymous).as("%s", kind).doesNotContain("{").isNotBlank();
      }
    }
    assertThat(
            CalloutLines.line(
                call(Callout.Kind.ENEMY, Optional.empty(), Optional.empty()),
                Optional.empty(),
                plain,
                random))
        .contains("blue bomb");
    assertThat(
            CalloutLines.line(
                call(Callout.Kind.ENEMY, Optional.of(50), Optional.of("behind you")),
                Optional.of("Jerred"),
                plain,
                random))
        .contains("Jerred")
        .contains("behind you");
    assertThat(
            CalloutLines.line(
                call(Callout.Kind.COVERING, Optional.of(50), Optional.empty()),
                Optional.of("Jerred"),
                plain,
                random))
        .contains("Jerred");
  }

  @Test
  void theSpeakersVoiceShapesTheCall() {
    var random = new SplittableRandom(9);
    var call = call(Callout.Kind.RETAKING, Optional.empty(), Optional.empty());
    var quiet =
        CalloutLines.line(
            call,
            Optional.empty(),
            Optional.of(voiced(List.of("terse"), "Top duelist, near-silent")),
            random);
    var lower =
        CalloutLines.line(
            call,
            Optional.empty(),
            Optional.of(voiced(List.of("dry"), "Two-word sarcasm, lowercase, period at the end")),
            random);
    var loud =
        CalloutLines.line(
            call,
            Optional.empty(),
            Optional.of(voiced(List.of("hype", "loud"), "motivational gym coach")),
            random);
    var plain =
        CalloutLines.line(
            call, Optional.empty(), Optional.of(voiced(List.of("dry"), "short and dry")), random);
    assertThat(quiet).isIn("retake", "blue bomb lit");
    assertThat(plain).isIn("Our bomb's lit, retake!", "Retake blue bomb!");
    assertThat(lower).isEqualTo(lower.toLowerCase(java.util.Locale.ROOT));
    assertThat(loud).endsWith("!");
  }
}
