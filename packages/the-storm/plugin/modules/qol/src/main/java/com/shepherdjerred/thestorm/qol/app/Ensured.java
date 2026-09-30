package com.shepherdjerred.thestorm.qol.app;

/**
 * A player row after {@link QolStore#ensure}.
 *
 * @param profile the stored row
 * @param created true when this call inserted it
 */
public record Ensured(PlayerProfile profile, boolean created) {}
