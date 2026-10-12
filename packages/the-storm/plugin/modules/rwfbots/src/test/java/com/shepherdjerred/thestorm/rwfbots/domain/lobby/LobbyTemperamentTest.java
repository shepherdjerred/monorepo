package com.shepherdjerred.thestorm.rwfbots.domain.lobby;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.Fixtures;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Personality;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Quirk;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Voice;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** Archetype, voice and quirks shape how a bot passes the time in the lobby. */
final class LobbyTemperamentTest {

  /** A test personality with {@code archetype}, {@code verbosity} and {@code quirks}. */
  static Personality bot(Archetype archetype, Voice.Verbosity verbosity, Set<Quirk> quirks) {
    var base =
        Fixtures.personality(
            "p-" + archetype.name().toLowerCase(java.util.Locale.ROOT).replace('_', '-'),
            "B_" + archetype.name(),
            0.5);
    return new Personality(
        base.id(),
        base.name(),
        base.skinValue(),
        base.skinSignature(),
        base.skill(),
        archetype,
        base.leverOffsets(),
        base.kits(),
        base.roles(),
        base.style(),
        new Voice(List.of("dry"), verbosity, "short and dry"),
        base.lines(),
        quirks,
        base.rivals(),
        base.bio(),
        base.batch(),
        base.retired());
  }

  static LobbyTemperament of(Archetype archetype) {
    return LobbyTemperament.of(bot(archetype, Voice.Verbosity.NORMAL, Set.of(Quirk.ALWAYS_GG)));
  }

  @Test
  void aTrollJumpsSneaksAndCrowdsPeopleMoreThanATactician() {
    var troll = of(Archetype.TROLL);
    var tactician = of(Archetype.TACTICIAN);

    assertThat(troll.weight(Activity.JUMP)).isGreaterThan(tactician.weight(Activity.JUMP) * 10);
    assertThat(troll.weight(Activity.SNEAK_TAP))
        .isGreaterThan(tactician.weight(Activity.SNEAK_TAP));
    assertThat(troll.weight(Activity.APPROACH)).isGreaterThan(tactician.weight(Activity.APPROACH));
    assertThat(troll.closeness()).isEqualTo(LobbyTemperament.NEAREST);
    assertThat(troll.switchBias()).isGreaterThan(of(Archetype.RUSHER).switchBias());
  }

  @Test
  void aTacticianBrowsesKitsAndStandsStill() {
    var tactician = of(Archetype.TACTICIAN);

    assertThat(tactician.weight(Activity.BROWSE_KITS))
        .isGreaterThan(tactician.weight(Activity.WANDER))
        .isGreaterThan(LobbyTemperament.BASE.get(Activity.BROWSE_KITS));
    assertThat(tactician.weight(Activity.LOOK_AROUND))
        .isGreaterThan(tactician.weight(Activity.WANDER));
  }

  @Test
  void aSupportWalksUpToOthersAndStaysClose() {
    var support = of(Archetype.SUPPORT);

    assertThat(support.weight(Activity.APPROACH))
        .isGreaterThan(LobbyTemperament.BASE.get(Activity.APPROACH));
    assertThat(support.weight(Activity.HANG_OUT))
        .isGreaterThan(LobbyTemperament.BASE.get(Activity.HANG_OUT));
    assertThat(support.closeness()).isLessThan(of(Archetype.LURKER).closeness());
  }

  @Test
  void quirksAndVoiceReachTheBody() {
    var plain = of(Archetype.HUNTER);
    var crouchy =
        LobbyTemperament.of(
            bot(Archetype.HUNTER, Voice.Verbosity.NORMAL, Set.of(Quirk.CROUCH_SPAM)));
    var hopper =
        LobbyTemperament.of(
            bot(Archetype.HUNTER, Voice.Verbosity.NORMAL, Set.of(Quirk.BUNNY_HOPS)));
    var chatty =
        LobbyTemperament.of(bot(Archetype.HUNTER, Voice.Verbosity.CHATTY, Set.of(Quirk.ALWAYS_GG)));
    var quiet =
        LobbyTemperament.of(bot(Archetype.HUNTER, Voice.Verbosity.QUIET, Set.of(Quirk.ALWAYS_GG)));

    assertThat(crouchy.weight(Activity.SNEAK_TAP)).isEqualTo(plain.weight(Activity.SNEAK_TAP) * 6);
    assertThat(hopper.weight(Activity.JUMP)).isEqualTo(plain.weight(Activity.JUMP) * 5);
    assertThat(chatty.weight(Activity.APPROACH)).isGreaterThan(quiet.weight(Activity.APPROACH));
  }

  @Test
  void drawsFollowTheWeights() {
    var random = new java.util.SplittableRandom(7);
    var trollJumps = 0;
    var tacticianJumps = 0;
    var troll = of(Archetype.TROLL);
    var tactician = of(Archetype.TACTICIAN);
    for (var i = 0; i < 2000; i++) {
      if (LobbyLife.draw(troll, java.util.Optional.empty(), random) == Activity.JUMP) {
        trollJumps++;
      }
      if (LobbyLife.draw(tactician, java.util.Optional.empty(), random) == Activity.JUMP) {
        tacticianJumps++;
      }
    }

    assertThat(trollJumps).isGreaterThan(tacticianJumps * 5);
  }
}
