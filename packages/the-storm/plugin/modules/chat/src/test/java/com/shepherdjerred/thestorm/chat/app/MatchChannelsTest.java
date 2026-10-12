package com.shepherdjerred.thestorm.chat.app;

import static com.shepherdjerred.thestorm.chat.app.Fixtures.ALICE;
import static com.shepherdjerred.thestorm.chat.app.Fixtures.ALICE_SPEAKS;
import static com.shepherdjerred.thestorm.chat.app.Fixtures.BOB;
import static com.shepherdjerred.thestorm.chat.app.Fixtures.CAROL;
import static com.shepherdjerred.thestorm.chat.app.Fixtures.CONFIG;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.chat.domain.ChannelAccess;
import com.shepherdjerred.thestorm.chat.domain.ChannelKey;
import com.shepherdjerred.thestorm.chat.domain.ChatDenial;
import com.shepherdjerred.thestorm.chat.domain.ChatProfile;
import com.shepherdjerred.thestorm.chat.domain.Speaker;
import com.shepherdjerred.thestorm.core.result.Result;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** Team and dead chat, routers, taps and NPC lines: the channels a match plugs into chat. */
final class MatchChannelsTest {

  private static final UUID BOT = UUID.fromString("00000000-0000-0000-0000-0000000000b0");
  private static final UUID DAVE = UUID.fromString("00000000-0000-0000-0000-00000000000d");

  private final Fixtures.Clock clock = new Fixtures.Clock();
  private final ChatExtensions extensions = new ChatExtensions();
  private final ChatService service =
      new ChatService(CONFIG, new Fixtures.RecordingStore(), clock, extensions);

  private static OutgoingLine sent(Result<OutgoingLine, List<ChatDenial>> result) {
    return switch (result) {
      case Result.Ok<OutgoingLine, List<ChatDenial>>(var line) -> line;
      case Result.Err<OutgoingLine, List<ChatDenial>>(var denials) ->
          throw new AssertionError("expected the line to send, got " + denials);
    };
  }

  /** The bot's line, heard by anyone the channel reaches. */
  private static NpcChat.Line npc(String name, ChatChannel channel, String text, String prefix) {
    return new NpcChat.Line(BOT, name, channel, text, prefix, player -> true);
  }

  /** Red is Alice, Bob and a bot; blue is Carol. Dave is dead. */
  private void match() {
    var red = Set.of(ALICE, BOB, BOT);
    var blue = Set.of(CAROL);
    var _ =
        extensions.registerMembership(
            ChatChannel.TEAM,
            speaker ->
                red.contains(speaker)
                    ? Optional.of(red)
                    : blue.contains(speaker) ? Optional.of(blue) : Optional.empty());
    var _ =
        extensions.registerMembership(
            ChatChannel.DEAD,
            speaker -> speaker.equals(DAVE) ? Optional.of(Set.of(DAVE)) : Optional.empty());
  }

  @Test
  void teamChatIsUnavailableOutsideAMatch() {
    assertThat(service.prepare(ALICE_SPEAKS, ChannelKey.TEAM, "push"))
        .isEqualTo(
            Result.err(
                List.of(new ChatDenial.NoAccess(ChannelKey.TEAM, ChannelAccess.UNAVAILABLE))));
  }

  @Test
  void teamLinesReachOnlyTheTeam() {
    match();

    var line = sent(service.prepare(ALICE_SPEAKS, ChannelKey.TEAM, "push mid"));

    assertThat(service.receives(line, BOB, false)).isTrue();
    assertThat(service.receives(line, BOT, false)).isTrue();
    assertThat(service.receives(line, CAROL, false)).isFalse();
    // Staff get no special view into another team's chat.
    assertThat(service.receives(line, DAVE, true)).isFalse();
  }

  @Test
  void aPlayerWithoutATeamIsNotAMember() {
    match();

    assertThat(service.access(new Speaker(DAVE, "Dave", false, false), ChannelKey.TEAM))
        .isEqualTo(ChannelAccess.NOT_A_MEMBER);
  }

  @Test
  void deadLinesNeverReachTheLiving() {
    match();
    var dave = new Speaker(DAVE, "Dave", false, false);

    var line = sent(service.prepare(dave, ChannelKey.DEAD, "gg"));

    assertThat(service.receives(line, DAVE, false)).isTrue();
    assertThat(service.receives(line, ALICE, false)).isFalse();
    assertThat(service.receives(line, CAROL, true)).isFalse();
    assertThat(service.access(ALICE_SPEAKS, ChannelKey.DEAD)).isEqualTo(ChannelAccess.NOT_A_MEMBER);
  }

  @Test
  void matchChannelsCannotBeFocused() {
    assertThat(ChannelKey.TEAM.focusable()).isFalse();
    assertThat(ChannelKey.DEAD.focusable()).isFalse();
    assertThat(ChannelKey.GLOBAL.focusable()).isTrue();
    assertThatThrownBy(() -> service.focus(ALICE_SPEAKS, ChannelKey.TEAM))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void membershipsRegisterOncePerChannelAndCanBeUndone() {
    var first = extensions.registerMembership(ChatChannel.TEAM, speaker -> Optional.empty());

    assertThatThrownBy(
            () -> extensions.registerMembership(ChatChannel.TEAM, speaker -> Optional.empty()))
        .isInstanceOf(IllegalStateException.class);
    assertThatThrownBy(
            () -> extensions.registerMembership(ChatChannel.GLOBAL, speaker -> Optional.empty()))
        .isInstanceOf(IllegalArgumentException.class);

    first.cancel();
    first.cancel();
    assertThat(service.access(ALICE_SPEAKS, ChannelKey.TEAM)).isEqualTo(ChannelAccess.UNAVAILABLE);
    var _ = extensions.registerMembership(ChatChannel.TEAM, speaker -> Optional.of(Set.of(ALICE)));
    assertThat(service.access(ALICE_SPEAKS, ChannelKey.TEAM)).isEqualTo(ChannelAccess.GRANTED);
  }

  @Test
  void withoutARouterLinesGoWhereTheyWereHeaded() {
    assertThat(service.route(ALICE, ChannelKey.GLOBAL, "@hi", false))
        .isEqualTo(new ChannelRouter.Routed(ChatChannel.GLOBAL, "@hi"));
  }

  @Test
  void theFirstRouterThatAnswersWinsAndCanStripAPrefix() {
    var asked = new ArrayList<ChannelRouter.Request>();
    var _ =
        extensions.registerRouter(
            request -> {
              asked.add(request);
              return !request.command() && request.text().startsWith("@")
                  ? Optional.of(
                      new ChannelRouter.Routed(ChatChannel.TEAM, request.text().substring(1)))
                  : Optional.empty();
            });
    var second =
        extensions.registerRouter(
            request -> Optional.of(new ChannelRouter.Routed(ChatChannel.DEAD, request.text())));

    assertThat(service.route(ALICE, ChannelKey.GLOBAL, "@rush b", false))
        .isEqualTo(new ChannelRouter.Routed(ChatChannel.TEAM, "rush b"));
    // A one-shot /g is not redirected by the first router, so the second answers.
    assertThat(service.route(ALICE, ChannelKey.GLOBAL, "@rush b", true))
        .isEqualTo(new ChannelRouter.Routed(ChatChannel.DEAD, "@rush b"));
    assertThat(asked)
        .containsExactly(
            new ChannelRouter.Request(ALICE, ChatChannel.GLOBAL, "@rush b", false),
            new ChannelRouter.Request(ALICE, ChatChannel.GLOBAL, "@rush b", true));

    second.cancel();
    assertThat(service.route(ALICE, ChannelKey.GLOBAL, "hello", true))
        .isEqualTo(new ChannelRouter.Routed(ChatChannel.GLOBAL, "hello"));
  }

  @Test
  void tapsHearDeliveredLinesButNotEmotes() {
    match();
    var heard = new ArrayList<ChatTap.Heard>();
    var tap = extensions.registerTap(heard::add);

    service.delivered(sent(service.prepare(ALICE_SPEAKS, ChannelKey.TEAM, "push mid")));
    service.delivered(sent(service.prepareEmote(ALICE_SPEAKS, "waves")));
    service.delivered(sent(service.prepareNpc(npc("Bot", ChatChannel.GLOBAL, "gl hf", ""))));
    tap.cancel();
    service.delivered(sent(service.prepare(ALICE_SPEAKS, ChannelKey.GLOBAL, "after")));

    assertThat(heard)
        .containsExactly(
            new ChatTap.Heard(ALICE, false, ChatChannel.TEAM, "push mid", clock.instant()),
            new ChatTap.Heard(BOT, true, ChatChannel.GLOBAL, "gl hf", clock.instant()));
  }

  @Test
  void aFailingTapDoesNotSilenceTheOthers() {
    var heard = new ArrayList<ChatTap.Heard>();
    var _ =
        extensions.registerTap(
            line -> {
              throw new IllegalStateException("broken tap");
            });
    var _ = extensions.registerTap(heard::add);

    var line = sent(service.prepare(ALICE_SPEAKS, ChannelKey.GLOBAL, "hi"));

    assertThatThrownBy(() -> service.delivered(line)).hasMessage("broken tap");
    assertThat(heard).hasSize(1);
  }

  @Test
  void npcLinesPassTheFiltersAndRespectIgnores() {
    match();
    service.ignore(CAROL, new ChatProfile.IgnoreTarget(BOT, "Bot", false));

    var line = sent(service.prepareNpc(npc("Bot ✦", ChatChannel.GLOBAL, "WE ARE SO BACK NOW", "")));

    assertThat(line.byNpc()).isTrue();
    assertThat(line.text()).isEqualTo("we are so back now");
    assertThat(service.receives(line, ALICE, false)).isTrue();
    assertThat(service.receives(line, CAROL, false)).isFalse();
    // The repeat limit holds for NPCs as for players.
    assertThat(service.prepareNpc(npc("Bot ✦", ChatChannel.GLOBAL, "WE ARE SO BACK NOW", "")))
        .isInstanceOf(Result.Err.class);
  }

  @Test
  void npcTeamLinesReachOnlyTheNpcsTeam() {
    match();

    var line = sent(service.prepareNpc(npc("Bot", ChatChannel.TEAM, "planted", "")));

    assertThat(service.receives(line, ALICE, false)).isTrue();
    assertThat(service.receives(line, CAROL, false)).isFalse();
  }

  @Test
  void anNpcOffEveryTeamCannotUseTeamChat() {
    var _ = extensions.registerMembership(ChatChannel.TEAM, speaker -> Optional.empty());

    assertThat(service.prepareNpc(npc("Bot", ChatChannel.TEAM, "planted", "")))
        .isEqualTo(
            Result.err(
                List.of(new ChatDenial.NoAccess(ChannelKey.TEAM, ChannelAccess.NOT_A_MEMBER))));
  }

  @Test
  void anNpcsTrustedPrefixReplacesTheProvidersPrefix() {
    extensions.registerPrefixProvider(player -> "<gold>Champion</gold>");

    var bot = sent(service.prepareNpc(npc("Bot", ChatChannel.GLOBAL, "hi", "<red>●</red>")));
    var player = sent(service.prepare(ALICE_SPEAKS, ChannelKey.GLOBAL, "hello"));

    assertThat(service.render(bot)).isEqualTo("[G][<red>●</red> Bot]: hi");
    assertThat(service.render(player)).isEqualTo("[G][<gold>Champion</gold> Alice]: hello");
  }
}
