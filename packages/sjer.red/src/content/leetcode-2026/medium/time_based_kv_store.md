---
title: "Time Based Key/Value Store"
date: 2026-03-22Z-0700
leetcode: true
---

## Problem

## Solution

```java
class TimeMap {

    // Essentially a K/V pair where the V can have multiple values, depending on access time
    // V will be a list of nodes with { time: int, value: string }
    // question: can we assume `set`'s `timestamp` will be monotonic? if so that get's us sorting for free and will mean we can do an efficient search
    // binary search should be good here -- will require a custom impl to find the _latest_ value
    // solved in 15 minutes

    record Node(String value, int timestamp) {}

    Map<String, ArrayList<Node>> map = new HashMap<>();

    public TimeMap() {

    }

    public void set(String key, String value, int timestamp) {
        var node = new Node(value, timestamp);
        if (map.containsKey(key)) {
            map.get(key).add(node);
        } else {
            map.put(key, new ArrayList<>(List.of(node)));
        }
    }

    public String get(String key, int timestamp) {
        if (!map.containsKey(key)) {
            return "";
        }

        var list = map.get(key);

        // binary search
        // find the LATEST node where timestamp in node <= timestamp on fn

        var left = 0;
        var right = list.size() - 1;
        var best = "";

        while (left <= right) {
            int middle = left + ((right - left) / 2);
            Node middleNode = list.get(middle);
            if (middleNode.timestamp == timestamp) {
                // perfect match, done
                return middleNode.value;
            } else if (middleNode.timestamp > timestamp) {
                // this doesn't match; we're too far over
                right = middle - 1;
            } else if (middleNode.timestamp < timestamp) {
                // this matches but might be a better match later
                // we can always set best since we will move left forward (so match will not become "worse")
                best = middleNode.value;
                left = middle + 1;
            } else {
                throw new IllegalStateException();
            }
        }

        return best;
    }
}

/**
 * Your TimeMap object will be instantiated and called as such:
 * TimeMap obj = new TimeMap();
 * obj.set(key,value,timestamp);
 * String param_2 = obj.get(key,timestamp);
 */
```
