package com.shepherdjerred.thestorm.essentials.domain.home;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.essentials.domain.place.PlaceName;
import com.shepherdjerred.thestorm.essentials.domain.place.Position;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

final class HomeRulesTest {

  static PlaceName name(String value) {
    return new PlaceName(value);
  }

  static Home home(String name) {
    return new Home(name(name), new Position("world", 1, 64, 1, 0, 0));
  }

  @Test
  void createsBelowTheLimit() {
    assertThat(HomeRules.set(List.of(name("a"), name("b")), name("c"), 3))
        .isEqualTo(Result.ok(HomeRules.Change.CREATED));
  }

  @Test
  void refusesANewHomeAtTheLimit() {
    assertThat(HomeRules.set(List.of(name("a"), name("b"), name("c")), name("d"), 3))
        .isEqualTo(Result.err(new HomeError.LimitReached(3)));
  }

  @Test
  void refusesANewHomeAboveTheLimitAfterItWasLowered() {
    assertThat(HomeRules.set(List.of(name("a"), name("b"), name("c")), name("d"), 1))
        .isEqualTo(Result.err(new HomeError.LimitReached(1)));
  }

  @Test
  void movingAnExistingHomeIsAllowedAtOrAboveTheLimit() {
    assertThat(HomeRules.set(List.of(name("a"), name("b"), name("c")), name("b"), 1))
        .isEqualTo(Result.ok(HomeRules.Change.MOVED));
  }

  @Test
  void theFirstHomeFitsALimitOfOne() {
    assertThat(HomeRules.set(List.of(), name("home"), 1))
        .isEqualTo(Result.ok(HomeRules.Change.CREATED));
  }

  @Test
  void resolvingWithNoHomesFails() {
    assertThat(HomeRules.resolve(List.of(), Optional.empty()))
        .isEqualTo(Result.err(new HomeError.NoHomes()));
    assertThat(HomeRules.resolve(List.of(), Optional.of(name("a"))))
        .isEqualTo(Result.err(new HomeError.NoHomes()));
  }

  @Test
  void resolvesANamedHome() {
    var homes = List.of(home("a"), home("b"));
    assertThat(HomeRules.resolve(homes, Optional.of(name("b")))).isEqualTo(Result.ok(home("b")));
  }

  @Test
  void anUnknownNameListsTheHomesSorted() {
    var homes = List.of(home("b"), home("a"));
    assertThat(HomeRules.resolve(homes, Optional.of(name("c"))))
        .isEqualTo(Result.err(new HomeError.NotFound(name("c"), List.of(name("a"), name("b")))));
  }

  @Test
  void withoutANameTheOnlyHomeIsUsed() {
    assertThat(HomeRules.resolve(List.of(home("base")), Optional.empty()))
        .isEqualTo(Result.ok(home("base")));
  }

  @Test
  void withoutANameTheDefaultHomeIsUsedAmongSeveral() {
    var homes = List.of(home("farm"), home("home"), home("mine"));
    assertThat(HomeRules.resolve(homes, Optional.empty())).isEqualTo(Result.ok(home("home")));
  }

  @Test
  void withoutANameSeveralHomesAreAmbiguous() {
    var homes = List.of(home("mine"), home("farm"));
    assertThat(HomeRules.resolve(homes, Optional.empty()))
        .isEqualTo(Result.err(new HomeError.Ambiguous(List.of(name("farm"), name("mine")))));
  }
}
