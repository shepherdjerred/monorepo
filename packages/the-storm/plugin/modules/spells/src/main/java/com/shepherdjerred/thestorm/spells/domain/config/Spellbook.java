package com.shepherdjerred.thestorm.spells.domain.config;

import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import java.util.EnumMap;
import java.util.Map;

/**
 * Every spell's entry, one component per {@link SpellKind} (the component name is the spell id). A
 * missing spell is a parse error, so no spell ever runs on defaults.
 */
public record Spellbook(
    SpellEntry<SpellSettings.None> mark,
    SpellEntry<SpellSettings.Search> recall,
    SpellEntry<SpellSettings.Buff> haste,
    SpellEntry<SpellSettings.Nova> firenova,
    SpellEntry<SpellSettings.Afflict> cripple,
    SpellEntry<SpellSettings.Radius> confusion,
    SpellEntry<SpellSettings.Radius> roar,
    SpellEntry<SpellSettings.Targeted> silence,
    SpellEntry<SpellSettings.Radius> dowse,
    SpellEntry<SpellSettings.None> cleanse,
    SpellEntry<SpellSettings.Phase> phase,
    SpellEntry<SpellSettings.Wall> wall,
    SpellEntry<SpellSettings.Geyser> geyser,
    SpellEntry<SpellSettings.Timed> stealth,
    SpellEntry<SpellSettings.Farm> farm,
    SpellEntry<SpellSettings.Push> forcepush,
    SpellEntry<SpellSettings.Range> disarm,
    SpellEntry<SpellSettings.Range> shadowstep,
    SpellEntry<SpellSettings.Divine> divine,
    SpellEntry<SpellSettings.Leap> leap,
    SpellEntry<SpellSettings.TimeShift> dawn,
    SpellEntry<SpellSettings.TimeShift> dusk,
    SpellEntry<SpellSettings.Freeze> freeze,
    SpellEntry<SpellSettings.Drain> drainlife,
    SpellEntry<SpellSettings.Range> blink,
    SpellEntry<SpellSettings.Carpet> carpet,
    SpellEntry<SpellSettings.Entomb> entomb,
    SpellEntry<SpellSettings.AreaDamage> purge,
    SpellEntry<SpellSettings.StormCall> stormcall,
    SpellEntry<SpellSettings.Ward> ward,
    SpellEntry<SpellSettings.Thunderclap> thunderclap,
    SpellEntry<SpellSettings.Chain> chainlightning) {

  /** The entry for {@code kind}. */
  public SpellEntry<?> entry(SpellKind kind) {
    var entry = all().get(kind);
    if (entry == null) {
      throw new IllegalStateException("the spellbook has no entry for " + kind);
    }
    return entry;
  }

  /** Every entry, in {@link SpellKind} order. */
  public Map<SpellKind, SpellEntry<?>> all() {
    var all = new EnumMap<SpellKind, SpellEntry<?>>(SpellKind.class);
    all.put(SpellKind.MARK, mark);
    all.put(SpellKind.RECALL, recall);
    all.put(SpellKind.HASTE, haste);
    all.put(SpellKind.FIRENOVA, firenova);
    all.put(SpellKind.CRIPPLE, cripple);
    all.put(SpellKind.CONFUSION, confusion);
    all.put(SpellKind.ROAR, roar);
    all.put(SpellKind.SILENCE, silence);
    all.put(SpellKind.DOWSE, dowse);
    all.put(SpellKind.CLEANSE, cleanse);
    all.put(SpellKind.PHASE, phase);
    all.put(SpellKind.WALL, wall);
    all.put(SpellKind.GEYSER, geyser);
    all.put(SpellKind.STEALTH, stealth);
    all.put(SpellKind.FARM, farm);
    all.put(SpellKind.FORCEPUSH, forcepush);
    all.put(SpellKind.DISARM, disarm);
    all.put(SpellKind.SHADOWSTEP, shadowstep);
    all.put(SpellKind.DIVINE, divine);
    all.put(SpellKind.LEAP, leap);
    all.put(SpellKind.DAWN, dawn);
    all.put(SpellKind.DUSK, dusk);
    all.put(SpellKind.FREEZE, freeze);
    all.put(SpellKind.DRAINLIFE, drainlife);
    all.put(SpellKind.BLINK, blink);
    all.put(SpellKind.CARPET, carpet);
    all.put(SpellKind.ENTOMB, entomb);
    all.put(SpellKind.PURGE, purge);
    all.put(SpellKind.STORMCALL, stormcall);
    all.put(SpellKind.WARD, ward);
    all.put(SpellKind.THUNDERCLAP, thunderclap);
    all.put(SpellKind.CHAINLIGHTNING, chainlightning);
    return all;
  }
}
