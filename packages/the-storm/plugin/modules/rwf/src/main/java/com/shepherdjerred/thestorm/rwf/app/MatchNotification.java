package com.shepherdjerred.thestorm.rwf.app;

import com.shepherdjerred.thestorm.rwf.domain.match.MatchEffect;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEvent;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import java.util.List;

/**
 * One accepted match transition, delivered to {@link MatchEvents} subscribers on the main thread
 * after every effect has been carried out.
 *
 * @param event the event the match accepted
 * @param effects what the server did in response, in order
 * @param after the match afterwards
 */
public record MatchNotification(MatchEvent event, List<MatchEffect> effects, MatchSnapshot after) {

  public MatchNotification {
    effects = List.copyOf(effects);
  }
}
