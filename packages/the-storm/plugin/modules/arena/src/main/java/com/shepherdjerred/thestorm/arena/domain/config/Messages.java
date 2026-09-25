package com.shepherdjerred.thestorm.arena.domain.config;

import com.shepherdjerred.thestorm.arena.domain.game.Notice;
import com.shepherdjerred.thestorm.arena.domain.game.NoticeKind;
import java.util.EnumMap;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * The arena's announcements. Each is plain text with {@code {placeholder}}s; a template may only
 * use the placeholders its message provides.
 *
 * @param joined a player joined the lobby: {player}, {arena}
 * @param left a player left: {player}
 * @param spectating to a new spectator: {arena}
 * @param classPicked to a player who picked a class: {class}
 * @param ready a player is ready: {player}
 * @param countdown the countdown started: {seconds}
 * @param countdownCancelled the countdown stopped because someone is not ready
 * @param gameStarted the game started: {arena}, {tier}, {waves}
 * @param waveStarted an ordinary wave: {wave}
 * @param swarmWave a swarm wave: {wave}
 * @param cavalryWave a cavalry wave: {wave}
 * @param bossWave a boss wave: {wave}, {boss}
 * @param upgradeWave an upgrade wave: {wave}
 * @param waveCleared a wave was cleared: {wave}
 * @param reward to a player paid for a wave: {amount}, {wave}
 * @param vaultOpened to a player whose milestone vault opened: {wave}
 * @param vaultAlreadyOpened to a player who opened that vault today already: {wave}
 * @param vaultDelivered to a player given their vault loot after leaving
 * @param died a fighter died: {player}, {wave}
 * @param victory the final wave was cleared: {arena}, {wave}
 * @param defeat every fighter is gone: {arena}, {wave}
 * @param removedWithoutClass to a player removed at the start for having no class
 * @param startedWithoutYou to a player whose join finished after the game started
 * @param heartBroken a boss's heart broke: {boss}
 * @param bossDefeated a boss died: {boss}
 * @param restored to a player whose belongings were restored after a crash
 */
public record Messages(
    String joined,
    String left,
    String spectating,
    String classPicked,
    String ready,
    String countdown,
    String countdownCancelled,
    String gameStarted,
    String waveStarted,
    String swarmWave,
    String cavalryWave,
    String bossWave,
    String upgradeWave,
    String waveCleared,
    String reward,
    String vaultOpened,
    String vaultAlreadyOpened,
    String vaultDelivered,
    String died,
    String victory,
    String defeat,
    String removedWithoutClass,
    String startedWithoutYou,
    String heartBroken,
    String bossDefeated,
    String restored) {

  private static final Pattern PLACEHOLDER = Pattern.compile("\\{([a-z]+)}");

  /**
   * Checks every template. A compact constructor cannot read its own fields, so {@link
   * ArenaSettings} calls this once the record exists.
   */
  void check() {
    for (var kind : NoticeKind.values()) {
      check(kind, template(kind));
    }
  }

  /** The template for {@code kind}. */
  public String template(NoticeKind kind) {
    var template = templates().get(kind);
    if (template == null) {
      throw new IllegalStateException("no message for " + kind);
    }
    return template;
  }

  /** {@code notice}'s template with its placeholders filled in. */
  public String render(Notice notice) {
    var text = template(notice.kind());
    for (var value : notice.values().entrySet()) {
      text = text.replace("{" + value.getKey() + "}", value.getValue());
    }
    return text;
  }

  private static void check(NoticeKind kind, String template) {
    if (template.isBlank()) {
      throw new IllegalArgumentException("the " + kind + " message must not be blank");
    }
    var allowed = kind.placeholders();
    var matcher = PLACEHOLDER.matcher(template);
    while (matcher.find()) {
      if (!allowed.contains(matcher.group(1))) {
        throw new IllegalArgumentException(
            "the " + kind + " message uses {" + matcher.group(1) + "}; it may use only " + allowed);
      }
    }
  }

  /** Every template by kind. Built per call: a record cannot hold derived fields. */
  private Map<NoticeKind, String> templates() {
    var templates = new EnumMap<NoticeKind, String>(NoticeKind.class);
    templates.put(NoticeKind.JOINED, joined);
    templates.put(NoticeKind.LEFT, left);
    templates.put(NoticeKind.SPECTATING, spectating);
    templates.put(NoticeKind.CLASS_PICKED, classPicked);
    templates.put(NoticeKind.READY, ready);
    templates.put(NoticeKind.COUNTDOWN, countdown);
    templates.put(NoticeKind.COUNTDOWN_CANCELLED, countdownCancelled);
    templates.put(NoticeKind.GAME_STARTED, gameStarted);
    templates.put(NoticeKind.WAVE_STARTED, waveStarted);
    templates.put(NoticeKind.SWARM_WAVE, swarmWave);
    templates.put(NoticeKind.CAVALRY_WAVE, cavalryWave);
    templates.put(NoticeKind.BOSS_WAVE, bossWave);
    templates.put(NoticeKind.UPGRADE_WAVE, upgradeWave);
    templates.put(NoticeKind.WAVE_CLEARED, waveCleared);
    templates.put(NoticeKind.REWARD, reward);
    templates.put(NoticeKind.VAULT_OPENED, vaultOpened);
    templates.put(NoticeKind.VAULT_ALREADY_OPENED, vaultAlreadyOpened);
    templates.put(NoticeKind.VAULT_DELIVERED, vaultDelivered);
    templates.put(NoticeKind.DIED, died);
    templates.put(NoticeKind.VICTORY, victory);
    templates.put(NoticeKind.DEFEAT, defeat);
    templates.put(NoticeKind.REMOVED_WITHOUT_CLASS, removedWithoutClass);
    templates.put(NoticeKind.STARTED_WITHOUT_YOU, startedWithoutYou);
    templates.put(NoticeKind.HEART_BROKEN, heartBroken);
    templates.put(NoticeKind.BOSS_DEFEATED, bossDefeated);
    templates.put(NoticeKind.RESTORED, restored);
    return templates;
  }
}
