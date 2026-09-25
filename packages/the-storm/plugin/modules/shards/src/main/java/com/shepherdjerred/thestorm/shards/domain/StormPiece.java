package com.shepherdjerred.thestorm.shards.domain;

/**
 * A piece of upgraded gear.
 *
 * @param category what kind of gear it is
 * @param tier its Storm tier
 */
public record StormPiece(GearCategory category, StormTier tier) {}
