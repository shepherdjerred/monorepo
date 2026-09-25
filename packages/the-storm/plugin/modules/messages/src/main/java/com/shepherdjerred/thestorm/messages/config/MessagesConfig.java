package com.shepherdjerred.thestorm.messages.config;

import com.shepherdjerred.thestorm.messages.domain.CommandBlocklist;
import com.shepherdjerred.thestorm.messages.domain.DeathCatalog;
import com.shepherdjerred.thestorm.messages.domain.DeathCause;
import com.shepherdjerred.thestorm.messages.domain.DeathSpamLimiter;
import com.shepherdjerred.thestorm.messages.domain.TemplatePool;
import java.time.Duration;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;

/**
 * {@code plugins/TheStorm/messages.yml}. Text shown in chat, the tab list and the server list is
 * MiniMessage, except death messages, which are plain text with {@code {player}}, {@code {killer}}
 * and {@code {weapon}} placeholders that the plugin styles.
 *
 * @param deaths death messages and death-spam limits
 * @param motd server-list messages, shown in rotation, one per ping
 * @param announcements periodic tips and ads
 * @param tab the tab list header and footer
 * @param commands commands hidden from players
 */
public record MessagesConfig(
    Deaths deaths, List<Motd> motd, Announcements announcements, Tab tab, Commands commands) {

  public MessagesConfig {
    motd = List.copyOf(motd);
    if (motd.isEmpty()) {
      throw new IllegalArgumentException("motd must list at least one message");
    }
  }

  /**
   * Death messages.
   *
   * @param spam when to stop broadcasting a player's deaths
   * @param unarmed the {@code {weapon}} text for a player killed by an empty hand
   * @param causes a list per death cause, keyed by cause (such as {@code fall}); {@code {player}}
   *     only
   * @param mobs deaths to mobs
   * @param players deaths to other players
   */
  public record Deaths(
      Spam spam,
      String unarmed,
      Map<String, List<String>> causes,
      MobDeaths mobs,
      PlayerDeaths players) {

    public Deaths {
      requireText(unarmed, "deaths.unarmed");
      causes = Map.copyOf(causes);
      // Build once so every template and key is checked at load.
      catalog(causes, mobs, players);
    }

    /** The validated catalog. */
    public DeathCatalog catalog() {
      return catalog(causes, mobs, players);
    }

    private static DeathCatalog catalog(
        Map<String, List<String>> causes, MobDeaths mobs, PlayerDeaths players) {
      var byCause = new EnumMap<DeathCause, TemplatePool>(DeathCause.class);
      causes.forEach((key, lines) -> byCause.put(cause(key), TemplatePool.parse(lines)));
      return new DeathCatalog(byCause, mobs.toDomain(), players.toDomain());
    }
  }

  /**
   * Death-spam limits: a player's deaths stop being broadcast after {@code maxDeaths} within {@code
   * window}, until they go a full window without dying.
   *
   * @param maxDeaths broadcast deaths allowed per window
   * @param window an ISO-8601 duration such as {@code PT5M}
   */
  public record Spam(int maxDeaths, Duration window) {

    public Spam {
      // Validates the invariants.
      DeathSpamLimiter.of(maxDeaths, window);
    }

    /** A limiter that has seen no deaths. */
    public DeathSpamLimiter limiter() {
      return DeathSpamLimiter.of(maxDeaths, window);
    }
  }

  /**
   * Deaths to mobs.
   *
   * @param any the general list
   * @param groups lists for particular mobs
   */
  public record MobDeaths(List<String> any, List<MobGroup> groups) {

    public MobDeaths {
      any = List.copyOf(any);
      groups = List.copyOf(groups);
      toDomain(any, groups);
    }

    DeathCatalog.Mobs toDomain() {
      return toDomain(any, groups);
    }

    private static DeathCatalog.Mobs toDomain(List<String> any, List<MobGroup> groups) {
      var byType = new HashMap<String, TemplatePool>();
      for (var group : groups) {
        var pool = TemplatePool.parse(group.messages());
        for (var type : group.types()) {
          if (byType.put(type, pool) != null) {
            throw new IllegalArgumentException("mob " + type + " is in more than one group");
          }
        }
      }
      return new DeathCatalog.Mobs(TemplatePool.parse(any), byType);
    }
  }

  /**
   * Messages shared by a group of related mobs, such as every kind of zombie.
   *
   * @param types entity type keys without namespace, such as {@code zombie_villager}
   * @param messages the templates
   */
  public record MobGroup(List<String> types, List<String> messages) {

    public MobGroup {
      types = List.copyOf(types);
      messages = List.copyOf(messages);
      if (types.isEmpty()) {
        throw new IllegalArgumentException("a mob group must name at least one type");
      }
      if (new HashSet<>(types).size() != types.size()) {
        throw new IllegalArgumentException("a mob group lists a type twice: " + types);
      }
    }
  }

  /**
   * Deaths to other players.
   *
   * @param any the general list
   * @param byCause lists for particular causes, keyed like {@link Deaths#causes()}
   */
  public record PlayerDeaths(List<String> any, Map<String, List<String>> byCause) {

    public PlayerDeaths {
      any = List.copyOf(any);
      byCause = Map.copyOf(byCause);
      toDomain(any, byCause);
    }

    DeathCatalog.Players toDomain() {
      return toDomain(any, byCause);
    }

    private static DeathCatalog.Players toDomain(
        List<String> any, Map<String, List<String>> byCause) {
      var pools = new EnumMap<DeathCause, TemplatePool>(DeathCause.class);
      byCause.forEach((key, lines) -> pools.put(cause(key), TemplatePool.parse(lines)));
      return new DeathCatalog.Players(TemplatePool.parse(any), pools);
    }
  }

  /**
   * One server-list message.
   *
   * @param top the first line
   * @param bottom the second line
   */
  public record Motd(String top, String bottom) {

    public Motd {
      requireText(top, "motd top");
      requireText(bottom, "motd bottom");
    }
  }

  /**
   * Periodic announcements.
   *
   * @param tips gameplay tips; at least one
   * @param ads advertisements; may be empty, which turns the ad announcer off
   */
  public record Announcements(Announcer tips, Announcer ads) {

    public Announcements {
      if (tips.messages().isEmpty()) {
        throw new IllegalArgumentException("announcements.tips must list at least one tip");
      }
    }
  }

  /**
   * One announcer.
   *
   * @param interval how often to announce, as an ISO-8601 duration such as {@code PT10M}
   * @param messages the messages, announced in shuffled rounds
   */
  public record Announcer(Duration interval, List<String> messages) {

    public Announcer {
      messages = List.copyOf(messages);
      if (interval.compareTo(Duration.ofSeconds(1)) < 0) {
        throw new IllegalArgumentException("interval must be at least one second: " + interval);
      }
      messages.forEach(message -> requireText(message, "announcement"));
    }
  }

  /**
   * The tab list.
   *
   * @param header shown above the player list
   * @param footer shown below it
   */
  public record Tab(String header, String footer) {

    public Tab {
      requireText(header, "tab.header");
      requireText(footer, "tab.footer");
    }
  }

  /**
   * Commands hidden from players.
   *
   * @param blocked labels, such as {@code plugins}; namespaced forms are blocked too
   * @param staffBypassPermission the permission that lifts the block
   * @param blockedMessage the reply to a blocked command
   */
  public record Commands(
      List<String> blocked, String staffBypassPermission, String blockedMessage) {

    public Commands {
      blocked = List.copyOf(blocked);
      if (new HashSet<>(blocked).size() != blocked.size()) {
        throw new IllegalArgumentException("commands.blocked lists a command twice: " + blocked);
      }
      new CommandBlocklist(new HashSet<>(blocked)).labels();
      requireText(blockedMessage, "commands.blockedMessage");
      if (staffBypassPermission.isBlank() || staffBypassPermission.contains(" ")) {
        throw new IllegalArgumentException(
            "commands.staffBypassPermission must be a permission node: " + staffBypassPermission);
      }
    }

    /** The validated blocklist. */
    public CommandBlocklist blocklist() {
      return new CommandBlocklist(new HashSet<>(blocked));
    }
  }

  private static DeathCause cause(String key) {
    return DeathCause.fromKey(key)
        .orElseThrow(() -> new IllegalArgumentException("unknown death cause: " + key));
  }

  private static void requireText(String text, String where) {
    if (text.isBlank()) {
      throw new IllegalArgumentException(where + " must not be blank");
    }
  }
}
