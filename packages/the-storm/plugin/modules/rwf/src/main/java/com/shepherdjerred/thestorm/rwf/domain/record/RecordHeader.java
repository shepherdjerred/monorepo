package com.shepherdjerred.thestorm.rwf.domain.record;

import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * What a recording is of. Combatants appear only under pseudonyms so a recording can be shared
 * without naming anyone.
 *
 * @param schemaVersion the record format; see {@link MatchRecord#SCHEMA_VERSION}
 * @param matchId the match
 * @param mapId the map played
 * @param mapBlocksSha256 the map's block hash, so the terrain is known exactly
 * @param seed the match seed, for the night roll and other randomness
 * @param roster everyone who fought
 * @param combatRulesVersion the combat rules in force
 */
public record RecordHeader(
    int schemaVersion,
    UUID matchId,
    String mapId,
    String mapBlocksSha256,
    long seed,
    List<RosterEntry> roster,
    String combatRulesVersion) {

  private static final Pattern SHA256 = Pattern.compile("[0-9a-f]{64}");

  public RecordHeader {
    if (schemaVersion < 1) {
      throw new IllegalArgumentException("schemaVersion must be positive");
    }
    if (mapId.isBlank() || combatRulesVersion.isBlank()) {
      throw new IllegalArgumentException("mapId and combatRulesVersion must not be blank");
    }
    if (!SHA256.matcher(mapBlocksSha256).matches()) {
      throw new IllegalArgumentException("mapBlocksSha256 must be 64 lower-case hex digits");
    }
    roster = List.copyOf(roster);
    if (roster.stream().map(RosterEntry::pseudonym).distinct().count() != roster.size()) {
      throw new IllegalArgumentException("roster pseudonyms must be unique");
    }
  }
}
