package com.shepherdjerred.thestorm.e2e.maps;

import com.shepherdjerred.thestorm.TheStormPlugin;
import com.shepherdjerred.thestorm.rwf.app.LobbySession;
import com.shepherdjerred.thestorm.rwf.app.MatchView;
import com.shepherdjerred.thestorm.rwf.app.RwfFeatures;
import com.shepherdjerred.thestorm.rwf.app.view.MatchState;
import com.shepherdjerred.thestorm.rwfbots.RwfBotsModule;
import com.shepherdjerred.thestorm.rwfbots.adapter.paper.MatchSession;
import com.shepherdjerred.thestorm.rwfbots.adapter.paper.RwfBotsPaper;
import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.Levers;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Style;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/** Read-only private fixture binding to the effective host settings and installed bot profile. */
final class AuthoredCombatSettings {
  private AuthoredCombatSettings() {}

  record Host(
      UUID match,
      boolean enabled,
      @Nullable UUID host,
      boolean locked,
      String selectedDifficulty,
      String currentDifficulty) {}

  record Profile(UUID body, String personality, Levers levers, Style style) {}

  record Effective(Host host, Profile profile) {}

  static Host host(TheStormPlugin storm) {
    if (!storm.getServer().isPrimaryThread())
      throw new IllegalStateException("authored settings inspection requires the main thread");
    var view = storm.service(MatchView.class);
    var owner = view.getClass();
    if (!owner.getName().equals("com.shepherdjerred.thestorm.rwf.adapter.paper.MatchRunner"))
      throw new IllegalStateException("ordinary match view implementation changed");
    var session = required(view, owner, "session", LobbySession.class);
    var features = required(view, owner, "features", RwfFeatures.class);
    return new Host(
        view.current().orElseThrow().matchId(),
        features.hostSettings(),
        session.host().orElse(null),
        session.locked(),
        session.selected().difficulty().name(),
        session.current().difficulty().name());
  }

  static Effective capture(TheStormPlugin storm, UUID bot) {
    var host = host(storm);
    var paper = installed(storm);
    var session = paper.roster().session().orElseThrow();
    if (!session.matchId().equals(host.match()))
      throw new IllegalStateException("bot profile belongs to another match");
    return new Effective(host, profile(paper, session, bot));
  }

  static List<Profile> profiles(TheStormPlugin storm) {
    var current = storm.service(MatchView.class).current().map(MatchState::of).orElseThrow();
    var paper = installed(storm);
    var session = paper.roster().session().orElseThrow();
    if (!session.matchId().equals(current.matchId()))
      throw new IllegalStateException("installed profiles belong to another match");
    return current.combatants().stream()
        .filter(MatchState.Fighter::bot)
        .map(fighter -> profile(paper, session, fighter.uuid()))
        .toList();
  }

  private static Profile profile(RwfBotsPaper paper, MatchSession session, UUID body) {
    var id = session.ids().known(body).orElseThrow();
    var installed = paper.loop().profile(id).orElseThrow();
    return new Profile(body, installed.personalityId(), installed.levers(), installed.style());
  }

  static void requireHard(Effective settings, UUID human) {
    var host = settings.host();
    if (!host.enabled()
        || !human.equals(host.host())
        || !host.locked()
        || !host.selectedDifficulty().equals("HARD")
        || !host.currentDifficulty().equals("HARD"))
      throw new IllegalStateException("requires the original human's frozen host HARD: " + host);
  }

  private static RwfBotsPaper installed(TheStormPlugin storm) {
    Object value = required(storm, TheStormPlugin.class, "enabled", List.class);
    if (!(value instanceof List<?> installed))
      throw new IllegalStateException("installed modules is not a list");
    var modules = installed.stream().filter(RwfBotsModule.class::isInstance).toList();
    if (modules.size() != 1)
      throw new IllegalStateException("expected one installed rwfbots module");
    return required(modules.getFirst(), RwfBotsModule.class, "paper", RwfBotsPaper.class);
  }

  private static <T> T required(Object target, Class<?> owner, String name, Class<T> expected) {
    if (!owner.isInstance(target)) throw new IllegalStateException("unexpected owner for " + name);
    try {
      var field = owner.getDeclaredField(name);
      if (field.getType() != expected || !field.trySetAccessible())
        throw new IllegalStateException("authored settings field contract changed: " + name);
      return expected.cast(Objects.requireNonNull(field.get(target), "missing " + name));
    } catch (ReflectiveOperationException failure) {
      throw new IllegalStateException("cannot inspect authored settings field " + name, failure);
    }
  }
}
