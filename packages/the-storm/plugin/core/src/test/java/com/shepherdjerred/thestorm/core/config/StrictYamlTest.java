package com.shepherdjerred.thestorm.core.config;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.result.Result;
import java.util.List;
import org.junit.jupiter.api.Test;

final class StrictYamlTest {

  record Reward(String item, int amount) {
    Reward {
      if (amount <= 0) {
        throw new IllegalArgumentException("amount must be positive");
      }
    }
  }

  record Quest(String name, List<Reward> rewards) {
    Quest {
      rewards = List.copyOf(rewards);
    }
  }

  @Test
  void parsesAValidDocument() {
    var yaml =
        """
        name: A Blacksmith's Task
        rewards:
          - item: IRON_INGOT
            amount: 32
        """;

    assertThat(StrictYaml.parse("quest.yml", yaml, Quest.class))
        .isEqualTo(
            Result.ok(new Quest("A Blacksmith's Task", List.of(new Reward("IRON_INGOT", 32)))));
  }

  @Test
  void rejectsUnknownKeys() {
    var result = StrictYaml.parse("quest.yml", "name: x\nrewards: []\nextra: 1\n", Quest.class);

    assertThat(problems(result))
        .singleElement()
        .satisfies(
            problem -> {
              assertThat(problem.source()).isEqualTo("quest.yml");
              assertThat(problem.message()).contains("extra");
            });
  }

  @Test
  void rejectsMissingProperties() {
    var result = StrictYaml.parse("quest.yml", "name: x\n", Quest.class);

    assertThat(problems(result))
        .singleElement()
        .satisfies(problem -> assertThat(problem.message()).contains("rewards"));
  }

  @Test
  void reportsInvariantViolationsWithTheirPath() {
    var yaml =
        """
        name: x
        rewards:
          - item: COD
            amount: 0
        """;

    assertThat(problems(StrictYaml.parse("quest.yml", yaml, Quest.class)))
        .singleElement()
        .satisfies(
            problem -> {
              assertThat(problem.path()).isEqualTo("rewards[0]");
              assertThat(problem.message()).isEqualTo("amount must be positive");
            });
  }

  private static List<Problem> problems(Result<Quest, List<Problem>> result) {
    return result.fold(value -> List.of(), errors -> errors);
  }
}
