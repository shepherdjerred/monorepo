package com.shepherdjerred.thestorm.messages.config;

import static java.util.stream.Collectors.toUnmodifiableSet;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import com.shepherdjerred.thestorm.core.config.Problem;
import com.shepherdjerred.thestorm.core.config.StrictYaml;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.messages.adapter.paper.MiniText;
import com.shepherdjerred.thestorm.messages.domain.DeathCause;
import com.shepherdjerred.thestorm.messages.domain.Killer;
import com.shepherdjerred.thestorm.messages.domain.Placeholder;
import java.io.IOException;
import java.lang.reflect.Field;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.SplittableRandom;
import org.bukkit.entity.EntityType;
import org.junit.jupiter.api.Test;

final class MessagesConfigTest {

  /** The file the server ships, relative to this module's project directory. */
  private static final Path SHIPPED =
      Path.of("../../../server/owned/plugins/TheStorm/messages.yml");

  @Test
  void theShippedFileParses() {
    var config = shipped();

    assertThat(config.deaths().spam().maxDeaths()).isEqualTo(3);
    assertThat(config.deaths().spam().window()).isEqualTo(Duration.ofMinutes(5));
    assertThat(config.announcements().tips().interval()).isEqualTo(Duration.ofMinutes(10));
    assertThat(config.announcements().ads().interval()).isEqualTo(Duration.ofMinutes(20));
    assertThat(config.announcements().tips().messages()).hasSizeGreaterThanOrEqualTo(15);
    assertThat(config.motd()).isNotEmpty();
    assertThat(config.commands().blocklist().blocksMessage("/bukkit:plugins")).isTrue();
    assertThat(config.commands().blocklist().blocksMessage("/help")).isTrue();
  }

  @Test
  void theShippedCatalogKeepsTheServersVoice() {
    var catalog = shipped().deaths().catalog();
    var players = catalog.poolFor(DeathCause.MELEE, new Killer.Player());
    var lava = catalog.poolFor(DeathCause.LAVA, new Killer.None());

    assertThat(players.templates())
        .anySatisfy(template -> assertThat(template.source()).contains("Nope, Chuck Testa"));
    assertThat(lava.templates())
        .anySatisfy(
            template -> assertThat(template.source()).contains("I told you not to dig straight"));
    assertThat(
            catalog
                .pick(DeathCause.FALL, new Killer.None(), new SplittableRandom(1))
                .render(Map.of(Placeholder.PLAYER, "RiotShielder")))
        .contains("RiotShielder");
  }

  @Test
  void theShippedMobGroupsNameRealEntityTypes() {
    var vanilla =
        Arrays.stream(EntityType.class.getFields())
            .filter(Field::isEnumConstant)
            .map(field -> field.getName().toLowerCase(Locale.ROOT))
            .collect(toUnmodifiableSet());
    var named =
        shipped().deaths().mobs().groups().stream()
            .flatMap(group -> group.types().stream())
            .toList();

    assertThat(named).isNotEmpty();
    assertThat(vanilla).containsAll(named);
  }

  @Test
  void theShippedTextIsStrictMiniMessage() {
    var config = shipped();
    var texts = new ArrayList<String>();
    config.motd().forEach(motd -> texts.addAll(List.of(motd.top(), motd.bottom())));
    texts.addAll(config.announcements().tips().messages());
    texts.addAll(config.announcements().ads().messages());
    texts.addAll(List.of(config.tab().header(), config.tab().footer()));
    texts.add(config.commands().blockedMessage());

    assertThat(texts).allSatisfy(text -> assertThat(MiniText.parse(text, "test")).isNotNull());
  }

  @Test
  void theShippedTipsOnlyMentionCommandsThatExist() {
    var config = shipped();

    assertThat(config.announcements().ads().messages()).isEmpty();
    assertThat(config.announcements().tips().messages())
        .noneMatch(tip -> tip.contains("toggle-ads"));
  }

  @Test
  void rejectsATagInADeathMessage() throws IOException {
    var yaml = shippedYaml().replace("\"{player} drowned\"", "\"{player} <aqua>drowned</aqua>\"");

    assertThat(problems(yaml))
        .singleElement()
        .satisfies(p -> assertThat(p.message()).contains("plain text"));
  }

  @Test
  void rejectsAnUnknownCause() throws IOException {
    var problems = problems(shippedYaml().replace("    melee:\n", "    contact:\n"));

    assertThat(problems)
        .singleElement()
        .satisfies(p -> assertThat(p.message()).contains("contact"));
  }

  @Test
  void rejectsAMissingCause() throws IOException {
    var yaml = shippedYaml().replaceFirst("(?s)    generic:\n.*?\n\n", "\n");

    assertThat(problems(yaml))
        .singleElement()
        .satisfies(p -> assertThat(p.message()).contains("missing causes: [generic]"));
  }

  @Test
  void rejectsAKillerInACauseList() throws IOException {
    var yaml =
        shippedYaml()
            .replace("\"{player} burned to death\"", "\"{player} was burned by {killer}\"");

    assertThat(problems(yaml))
        .singleElement()
        .satisfies(p -> assertThat(p.message()).contains("cause fire cannot use {killer}"));
  }

  @Test
  void rejectsAnUnknownPlaceholder() throws IOException {
    var yaml = shippedYaml().replace("\"{player} drowned\"", "\"%victim% drowned {victim}\"");

    assertThat(problems(yaml))
        .singleElement()
        .satisfies(p -> assertThat(p.message()).contains("unknown placeholder {victim}"));
  }

  @Test
  void rejectsAMobInTwoGroups() throws IOException {
    var yaml = shippedYaml().replace("types: [bee]", "types: [bee, creeper]");

    assertThat(problems(yaml))
        .singleElement()
        .satisfies(p -> assertThat(p.message()).contains("creeper is in more than one group"));
  }

  @Test
  void rejectsNoTips() throws IOException {
    var yaml =
        shippedYaml()
            .replaceFirst(
                "(?s)(  tips:\n    interval: PT10M\n)    messages:\n.*?\n  ads:",
                "$1    messages: []\n  ads:");

    assertThat(problems(yaml))
        .singleElement()
        .satisfies(p -> assertThat(p.message()).contains("at least one tip"));
  }

  @Test
  void rejectsABadInterval() throws IOException {
    assertThat(problems(shippedYaml().replace("interval: PT20M", "interval: 20 minutes")))
        .isNotEmpty();
    assertThat(problems(shippedYaml().replace("interval: PT20M", "interval: PT0S")))
        .singleElement()
        .satisfies(p -> assertThat(p.message()).contains("at least one second"));
  }

  @Test
  void rejectsABadSpamLimit() throws IOException {
    assertThat(problems(shippedYaml().replace("maxDeaths: 3", "maxDeaths: 0")))
        .singleElement()
        .satisfies(p -> assertThat(p.message()).contains("maxDeaths"));
  }

  @Test
  void rejectsASlashedBlockedCommand() throws IOException {
    assertThat(problems(shippedYaml().replace("blocked: [pl,", "blocked: [/pl,")))
        .singleElement()
        .satisfies(p -> assertThat(p.message()).contains("bare lowercase label"));
  }

  @Test
  void rejectsUnknownKeys() throws IOException {
    assertThat(problems(shippedYaml() + "extra: true\n")).isNotEmpty();
  }

  private static MessagesConfig shipped() {
    return ConfigFiles.load(SHIPPED, MessagesConfig.class);
  }

  private static String shippedYaml() throws IOException {
    return Files.readString(SHIPPED);
  }

  private static List<Problem> problems(String yaml) {
    return switch (StrictYaml.parse("messages.yml", yaml, MessagesConfig.class)) {
      case Result.Ok<MessagesConfig, List<Problem>>(var _) -> List.of();
      case Result.Err<MessagesConfig, List<Problem>>(var problems) -> problems;
    };
  }
}
