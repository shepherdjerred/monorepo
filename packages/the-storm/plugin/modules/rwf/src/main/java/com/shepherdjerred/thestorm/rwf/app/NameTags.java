package com.shepherdjerred.thestorm.rwf.app;

import java.util.UUID;

/**
 * Whose name tag the enemy sees. Normal team members show theirs to everyone (the scoreboard team's
 * name tags are always visible, through walls as far as the client draws them); an invisible kit
 * (Ghost, Wraith) or a disguise wearing another's name sits on its team's hidden team, whose tags
 * never show. A Spy's tag reads as the viewer's own team. Main thread only.
 */
@FunctionalInterface
public interface NameTags {

  /** Whether enemies of {@code player} see no name tag over them. */
  boolean hiddenFromEnemies(UUID player);
}
