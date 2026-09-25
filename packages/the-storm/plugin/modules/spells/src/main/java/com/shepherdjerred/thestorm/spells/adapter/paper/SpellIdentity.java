package com.shepherdjerred.thestorm.spells.adapter.paper;

import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import java.util.UUID;

/** What a spell item is, read from its persistent data. */
sealed interface SpellIdentity {

  SpellKind spell();

  /** A reusable focus bound to {@code owner}; valid while {@code generation} is current. */
  record Focus(SpellKind spell, UUID owner, long generation) implements SpellIdentity {}

  /** A single-use scroll anyone can read. */
  record Scroll(SpellKind spell) implements SpellIdentity {}
}
