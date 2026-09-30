package com.shepherdjerred.thestorm.spells.domain;

import java.util.UUID;

/**
 * One player's focus for one spell. Each bind raises the key's generation; only a focus carrying
 * the current generation casts, so copies and replaced foci are worthless.
 */
public record FocusKey(UUID player, SpellKind spell) {}
