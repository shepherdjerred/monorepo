package com.shepherdjerred.castlecasters.logic.match;

import lombok.EqualsAndHashCode;
import lombok.ToString;

import java.util.Stack;

@ToString
@EqualsAndHashCode
public class MatchHistory {

  private final Stack<MatchHistoryEntry> matchHistory;

  public MatchHistory() {
    this.matchHistory = new Stack<>();
  }

  private MatchHistory(Stack<MatchHistoryEntry> matchHistory) {
    this.matchHistory = matchHistory;
  }

  public MatchHistory push(MatchHistoryEntry entry) {
    var newMatchHistory = new Stack<MatchHistoryEntry>();
    newMatchHistory.addAll(matchHistory);
    newMatchHistory.push(entry);
    return new MatchHistory(newMatchHistory);
  }

  public MatchHistoryEntry pop() {
    return matchHistory.pop();
  }

  public boolean isEmpty() {
    return matchHistory.isEmpty();
  }

  public int getSize() {
    return matchHistory.size();
  }
}
