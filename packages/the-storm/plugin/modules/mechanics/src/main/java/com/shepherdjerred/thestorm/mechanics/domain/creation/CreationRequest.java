package com.shepherdjerred.thestorm.mechanics.domain.creation;

import com.shepherdjerred.thestorm.mechanics.domain.grid.BlockGrid;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import com.shepherdjerred.thestorm.mechanics.domain.grid.SignView;
import com.shepherdjerred.thestorm.mechanics.domain.sign.Mechanism;

/**
 * A sign just written with a mechanism tag.
 *
 * @param mechanism what the tag names
 * @param sign where the sign is
 * @param view the sign with its new text
 * @param grid the world around it
 */
public record CreationRequest(Mechanism mechanism, Pos sign, SignView view, BlockGrid grid) {}
