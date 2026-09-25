package com.shepherdjerred.thestorm.spells.adapter.paper.spell;

import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import com.shepherdjerred.thestorm.spells.domain.config.Spellbook;
import java.util.EnumMap;
import java.util.Map;

/** Builds every spell from its {@code spells.yml} settings. */
public final class Spells {

  private Spells() {}

  /** One spell per {@link SpellKind}; throws if any kind lacks a spell. */
  public static Map<SpellKind, Spell> create(Spellbook book, Toolbox tools) {
    var spells = new EnumMap<SpellKind, Spell>(SpellKind.class);
    add(spells, new Mark(tools));
    add(spells, new Recall(book.recall().settings(), tools));
    add(spells, new Haste(book.haste().settings(), tools));
    add(spells, new FireNova(book.firenova().settings(), tools));
    add(spells, new Cripple(book.cripple().settings(), tools));
    add(spells, new Confusion(book.confusion().settings(), tools));
    add(spells, new Roar(book.roar().settings(), tools));
    add(spells, new Silence(book.silence().settings(), tools));
    add(spells, new Dowse(book.dowse().settings(), tools));
    add(spells, new Cleanse(tools));
    add(spells, new Phase(book.phase().settings(), tools));
    add(spells, new Wall(book.wall().settings(), tools));
    add(spells, new Geyser(book.geyser().settings(), tools));
    add(spells, new Stealth(book.stealth().settings(), tools));
    add(spells, new Farm(book.farm().settings(), tools));
    add(spells, new ForcePush(book.forcepush().settings(), tools));
    add(spells, new Disarm(book.disarm().settings(), tools));
    add(spells, new Shadowstep(book.shadowstep().settings(), tools));
    add(spells, new Divine(book.divine().settings(), tools));
    add(spells, new Leap(book.leap().settings(), tools));
    add(spells, new ShiftSky(SpellKind.DAWN, book.dawn().settings(), tools));
    add(spells, new ShiftSky(SpellKind.DUSK, book.dusk().settings(), tools));
    add(spells, new Freeze(book.freeze().settings(), tools));
    add(spells, new DrainLife(book.drainlife().settings(), tools));
    add(spells, new Blink(book.blink().settings(), tools));
    add(spells, new Carpet(book.carpet().settings(), tools));
    add(spells, new Entomb(book.entomb().settings(), tools));
    add(spells, new Purge(book.purge().settings(), tools));
    add(spells, new StormCall(book.stormcall().settings(), tools));
    add(spells, new Ward(book.ward().settings(), tools));
    add(spells, new Thunderclap(book.thunderclap().settings(), tools));
    add(spells, new ChainLightning(book.chainlightning().settings(), tools));
    for (var kind : SpellKind.values()) {
      if (!spells.containsKey(kind)) {
        throw new IllegalStateException("no spell implements " + kind);
      }
    }
    return Map.copyOf(spells);
  }

  private static void add(Map<SpellKind, Spell> spells, Spell spell) {
    if (spells.put(spell.kind(), spell) != null) {
      throw new IllegalStateException("two spells implement " + spell.kind());
    }
  }
}
