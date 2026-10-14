package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.app.MatchView;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitAccess;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitBook;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitBrowser;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitSpec;
import com.shepherdjerred.thestorm.rwf.domain.match.Combatant;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchError;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEvent;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;
import org.bukkit.entity.Player;

/** Picking a kit and browsing the kit menu, against what each player owns. */
final class KitPicker {

  private final MatchRunner runner;
  private final KitMenus menus;

  KitPicker(MatchRunner runner, KitMenus menus) {
    this.runner = runner;
    this.menus = menus;
  }

  /** {@code player} picks {@code kit}, as {@code /rwf kit} and the kit menu do; why not, if not. */
  Optional<String> pick(Player player, String kit) {
    var member = runner.memberOf(player.getUniqueId());
    if (member.isEmpty()) {
      return Optional.of(Texts.describe(MatchError.NOT_A_MEMBER));
    }
    // Before their kits load, a player may still pick the first four kits: those are open to
    // everyone whatever they own, so the answer cannot change once the load lands.
    var access = access(member.orElseThrow().id());
    var refused =
        runner.handle(
            new MatchEvent.PickKit(
                member.orElseThrow().id(), kit, access.orElse(KitAccess.MILESTONE_ONE)));
    if (access.isEmpty() && refused.filter(MatchError.KIT_LOCKED::equals).isPresent()) {
      load(player.getUniqueId());
      return Optional.of("Your kits are still loading; try again in a moment.");
    }
    return refused.map(Texts::describe);
  }

  /**
   * Which kits {@code id} may pick: every kit for a bot, which owns nothing and drafts from its own
   * allow-list; for a human, what they own and what rotates free, once loaded.
   */
  Optional<KitAccess> access(CombatantId id) {
    return switch (id) {
      case CombatantId.Bot _ -> Optional.of(KitAccess.EVERYTHING);
      case CombatantId.Human human -> menus.armory().access(human.uuid());
    };
  }

  /**
   * Opens the kit menu: for a member waiting for the start, marking the kit they picked; for anyone
   * else, to browse and buy kits.
   */
  Optional<String> open(Player player) {
    var member = runner.memberOf(player.getUniqueId());
    if (member.isPresent() && !runner.match().phase().kitsOpen()) {
      return Optional.of(Texts.describe(MatchError.NOT_PRE_GAME));
    }
    browse(player, menus.query(player.getUniqueId()));
    return Optional.empty();
  }

  /** Opens page {@code page} of the kit menu, marking the kit {@code player} picked, if any. */
  void browse(Player player, int page) {
    menus.open(player, runner.memberOf(player.getUniqueId()).flatMap(Combatant::kit), page);
  }

  void browse(Player player, KitBrowser.Query query) {
    menus.open(player, runner.memberOf(player.getUniqueId()).flatMap(Combatant::kit), query);
  }

  void browse(Player player) {
    browse(player, menus.query(player.getUniqueId()));
  }

  /** The kits bots may play: every kit while the full list is on for anyone here. */
  java.util.Set<String> onOffer() {
    return runner.match().members().stream()
            .filter(member -> !member.id().isBot())
            .anyMatch(member -> menus.armory().expanded(member.id().uuid()))
        ? KitBook.ALL.stream().map(KitSpec::id).collect(Collectors.toUnmodifiableSet())
        : MatchView.MILESTONE_KITS;
  }

  /**
   * Starts reading {@code player}'s kits, as they join; once read, a member who has not picked yet
   * gets the kit they last played, when they may still pick it.
   */
  void load(UUID player) {
    menus.armory().load(player, () -> pickLast(player));
  }

  private void pickLast(UUID player) {
    var member = runner.memberOf(player);
    var last = menus.armory().lastKit(player);
    var access = menus.armory().access(player);
    if (member.isEmpty()
        || member.orElseThrow().kit().isPresent()
        || last.isEmpty()
        || access.isEmpty()
        || !runner.match().phase().kitsOpen()) {
      return;
    }
    var _ =
        runner.handle(
            new MatchEvent.PickKit(
                member.orElseThrow().id(), last.orElseThrow(), access.orElseThrow()));
  }

  /** {@code player} quit: their loaded kits are dropped, and read afresh when they come back. */
  void forget(UUID player) {
    menus.forget(player);
    menus.armory().forget(player);
  }
}
