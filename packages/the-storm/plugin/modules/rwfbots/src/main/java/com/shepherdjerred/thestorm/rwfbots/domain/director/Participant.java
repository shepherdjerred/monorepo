package com.shepherdjerred.thestorm.rwfbots.domain.director;

/**
 * Someone to put on a team.
 *
 * @param id a stable id, unique in the lobby
 * @param rating their rating
 * @param human whether a person rather than a bot
 */
public record Participant(String id, Rating rating, boolean human) {

  public Participant {
    if (id.isBlank()) {
      throw new IllegalArgumentException("participant id must not be blank");
    }
  }
}
