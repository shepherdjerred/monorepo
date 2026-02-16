package com.shepherdjerred.castlecasters.common.lobby;

import com.shepherdjerred.castlecasters.common.player.Element;
import lombok.ToString;

import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

@ToString
class ElementCounts {

  private final Map<Element, Integer> elementCounts;

  ElementCounts() {
    elementCounts = new HashMap<>();
  }

  private ElementCounts(Map<Element, Integer> elementCounts) {
    this.elementCounts = elementCounts;
  }

  boolean areUnique() {
    for (Integer i : elementCounts.values()) {
      if (i > 1) {
        return false;
      }
    }
    return true;
  }

  Optional<Element> getNextFreeElement() {
    for (Element element : Element.values()) {
      if (!hasElement(element)) {
        return Optional.of(element);
      }
    }
    return Optional.empty();
  }

  ElementCounts increment(Element e) {
    var newElementCounts = new HashMap<>(elementCounts);

    if (newElementCounts.containsKey(e)) {
      newElementCounts.compute(e, (k, currentValue) -> currentValue + 1);
    } else {
      newElementCounts.put(e, 1);
    }

    return new ElementCounts(newElementCounts);
  }

  ElementCounts decrement(Element e) {
    var newElementCounts = new HashMap<>(elementCounts);

    if (newElementCounts.containsKey(e)) {
      var currentValue = newElementCounts.get(e);

      if (currentValue > 0) {
        newElementCounts.put(e, currentValue - 1);
      } else {
        throw new IllegalStateException("Cannot decrement when count is at 0");
      }
    } else {
      throw new IllegalStateException("Cannot decrement when element not in map");
    }

    return new ElementCounts(newElementCounts);
  }

  public boolean hasElement(Element e) {
    return elementCounts.containsKey(e) && elementCounts.get(e) > 0;
  }
}
