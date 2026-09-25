package com.shepherdjerred.thestorm.messages.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.messages.domain.Template.Segment;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

final class TemplateTest {

  @Test
  void splitsTextAndPlaceholders() {
    var template = Template.parse("{player} was ravaged by a {killer}");

    assertThat(template.segments())
        .containsExactly(
            new Segment.Slot(Placeholder.PLAYER),
            new Segment.Text(" was ravaged by a "),
            new Segment.Slot(Placeholder.KILLER));
    assertThat(template.placeholders()).containsExactly(Placeholder.PLAYER, Placeholder.KILLER);
  }

  @Test
  void substitutesEveryPlaceholder() {
    var template = Template.parse("{killer} killed {player} wielding {weapon}");

    var rendered =
        template.render(
            Map.of(
                Placeholder.PLAYER, "Steve",
                Placeholder.KILLER, "Alex",
                Placeholder.WEAPON, "Diamond Sword"));

    assertThat(rendered).isEqualTo("Alex killed Steve wielding Diamond Sword");
  }

  @Test
  void substitutesRepeatedAndAdjacentPlaceholders() {
    var template = Template.parse("{player}{player}, you ok? {player}?");

    assertThat(template.render(Map.of(Placeholder.PLAYER, "Riot")))
        .isEqualTo("RiotRiot, you ok? Riot?");
  }

  @Test
  void keepsTextWithoutPlaceholders() {
    var template = Template.parse("Nope, Chuck Testa");

    assertThat(template.segments()).containsExactly(new Segment.Text("Nope, Chuck Testa"));
    assertThat(template.placeholders()).isEmpty();
    assertThat(template.render(Map.of())).isEqualTo("Nope, Chuck Testa");
  }

  @Test
  void doesNotReinterpretSubstitutedText() {
    var template = Template.parse("{player} was shot by {killer}");

    assertThat(template.render(Map.of(Placeholder.PLAYER, "{killer}", Placeholder.KILLER, "<red>")))
        .isEqualTo("{killer} was shot by <red>");
  }

  @Test
  void rejectsRenderingWithoutAValue() {
    var template = Template.parse("{player} was shot by {killer}");

    assertThatThrownBy(() -> template.render(Map.of(Placeholder.PLAYER, "Steve")))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("{killer}");
  }

  @Test
  void roundTripsItsSource() {
    var source = "Dear {player}, good luck finding your stuff. - {killer}";

    assertThat(Template.parse(source).source()).isEqualTo(source);
  }

  @Test
  void fillsSegmentsInOrder() {
    var parts =
        Template.parse("{player} hugged a {killer}")
            .fill(placeholder -> "[" + placeholder + "]", text -> text);

    assertThat(parts).containsExactly("[PLAYER]", " hugged a ", "[KILLER]");
  }

  @ParameterizedTest
  @ValueSource(strings = {"{victim} died", "{Player} died", "{} died", "{player died", "died}"})
  void rejectsMalformedTemplates(String source) {
    assertThatThrownBy(() -> Template.parse(source)).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void rejectsAnEmptyTemplate() {
    assertThatThrownBy(() -> Template.parse("")).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Template(List.of())).isInstanceOf(IllegalArgumentException.class);
  }
}
