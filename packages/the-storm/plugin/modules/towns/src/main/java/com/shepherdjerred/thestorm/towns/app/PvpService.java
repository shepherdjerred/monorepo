package com.shepherdjerred.thestorm.towns.app;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.towns.domain.protection.PvpPreferences;
import com.shepherdjerred.thestorm.towns.domain.pvp.PvpPolicy;
import com.shepherdjerred.thestorm.towns.domain.pvp.PvpProblem;
import com.shepherdjerred.thestorm.towns.domain.pvp.PvpRules;
import com.shepherdjerred.thestorm.towns.domain.pvp.PvpSetting;
import java.time.Instant;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * Players' own PvP switches, in memory for the protection engine and saved behind it. A change
 * applies only after storage commits when enabling; disabling applies immediately. If a save fails,
 * every switch is reloaded from storage. Main thread only.
 */
public final class PvpService implements PvpPreferences {

  private final PvpStore store;
  private final PvpPolicy policy;
  private final Clocks clocks;
  private final Map<UUID, PvpSetting> settings = new HashMap<>();
  private final Set<UUID> busy = new HashSet<>();
  private final Map<UUID, Instant> fightUntil = new HashMap<>();
  private boolean reloading;

  public PvpService(PvpStore store, PvpPolicy policy, Clocks clocks) {
    this.store = store;
    this.policy = policy;
    this.clocks = clocks;
  }

  /** Replaces every switch with {@code stored}. */
  public void load(Map<UUID, PvpSetting> stored) {
    settings.clear();
    settings.putAll(stored);
  }

  @Override
  public boolean pvpOn(UUID player) {
    return PvpRules.isOn(setting(player));
  }

  public Optional<PvpSetting> setting(UUID player) {
    return Optional.ofNullable(settings.get(player));
  }

  /**
   * Records that {@code attacker} and {@code victim} just fought: neither may change their switch
   * for the configured while. Kept in memory; a restart forgets it.
   */
  public void recordFight(UUID attacker, UUID victim) {
    var until = now().plus(policy.combatLock());
    fightUntil.put(attacker, until);
    fightUntil.put(victim, until);
  }

  /** Forgets {@code player}'s fight once it no longer matters, for when they leave. */
  public void forgetFight(UUID player) {
    var until = fightUntil.get(player);
    if (until != null && !now().isBefore(until)) {
      fightUntil.remove(player);
    }
  }

  /** When {@code player} may next change their switch; empty if they may now. */
  public Optional<Instant> nextChange(UUID player) {
    var current = now();
    var cooldown = PvpRules.nextChange(setting(player), current, policy.cooldown());
    var fight =
        Optional.ofNullable(fightUntil.get(player)).filter(until -> current.isBefore(until));
    if (fight.isEmpty()) {
      return cooldown;
    }
    return Optional.of(cooldown.filter(until -> until.isAfter(fight.get())).orElseGet(fight::get));
  }

  /** Switches {@code player}'s PvP to {@code on}. */
  public Result<Change<PvpSetting>, PvpProblem> set(UUID player, boolean on) {
    if (reloading || busy.contains(player)) {
      return Result.err(new PvpProblem.Busy());
    }
    var timing =
        new PvpRules.Timing(policy.cooldown(), Optional.ofNullable(fightUntil.get(player)));
    return PvpRules.change(setting(player), on, now(), timing)
        .map(
            setting -> {
              if (!on) {
                settings.put(player, setting);
              }
              busy.add(player);
              var saved = new CompletableFuture<Void>();
              var _ =
                  store
                      .save(player, setting)
                      .whenCompleteAsync(
                          (ok, failure) -> {
                            busy.remove(player);
                            if (failure == null) {
                              settings.put(player, setting);
                              saved.complete(null);
                            } else {
                              reload(saved, failure);
                            }
                          },
                          clocks.mainThread());
              return new Change<>(setting, saved);
            });
  }

  private void reload(CompletableFuture<Void> saved, Throwable failure) {
    reloading = true;
    var _ =
        store
            .loadAll()
            .whenCompleteAsync(
                (stored, loadFailure) -> {
                  if (loadFailure != null) {
                    clocks.reloadFailed().accept(loadFailure);
                  } else {
                    load(stored);
                    reloading = false;
                  }
                  saved.completeExceptionally(failure);
                },
                clocks.mainThread());
  }

  public Instant now() {
    return clocks.time().instant();
  }
}
