---
title: "Logger Rate Limiter"
date: 2024-08-02Z-0700
leetcode: true
---

## Problem

Design a logger system that receives a stream of messages along with their timestamps. Each unique message should only be printed at most every 10 seconds (i.e. a message printed at timestamp t will prevent other identical messages from being printed until timestamp t + 10).

All messages will come in chronological order. Several messages may arrive at the same timestamp.

Implement the Logger class:

- Logger() Initializes the logger object.
- bool shouldPrintMessage(int timestamp, string message) Returns true if the message should be printed in the given timestamp, otherwise returns false.

Example 1:

```text
Input
["Logger", "shouldPrintMessage", "shouldPrintMessage", "shouldPrintMessage", "shouldPrintMessage", "shouldPrintMessage", "shouldPrintMessage"]
[[], [1, "foo"], [2, "bar"], [3, "foo"], [8, "bar"], [10, "foo"], [11, "foo"]]
Output
[null, true, true, false, false, false, true]

Explanation
Logger logger = new Logger();
logger.shouldPrintMessage(1, "foo");  // return true, next allowed timestamp for "foo" is 1 + 10 = 11
logger.shouldPrintMessage(2, "bar");  // return true, next allowed timestamp for "bar" is 2 + 10 = 12
logger.shouldPrintMessage(3, "foo");  // 3 < 11, return false
logger.shouldPrintMessage(8, "bar");  // 8 < 12, return false
logger.shouldPrintMessage(10, "foo"); // 10 < 11, return false
logger.shouldPrintMessage(11, "foo"); // 11 >= 11, return true, next allowed timestamp for "foo" is 11 + 10 = 21
```

Constraints:

- 0 <= timestamp <= 109
- Every timestamp will be passed in non-decreasing order (chronological order).
- 1 <= message.length <= 30
- At most 104 calls will be made to shouldPrintMessage.

## Solution

### Using a Map

```java
class Logger {
    Map<String, Integer> m = new HashMap<>();

    public boolean shouldPrintMessage(int timestamp, String message) {
        var t = m.getOrDefault(message, 0);
        if (timestamp >= t) {
            m.put(message, timestamp + 10);
            return true;
        }
        return false;
    }
}
```

### Using a Queue

More space efficient

```java
class Logger {
    static class Pair<K, V> {
        K k;
        V v;
        Pair(K k, V v) {
            this.k = k;
            this.v = v;
        }
    }

    Set<String> s = new HashSet<>();
    Queue<Pair<Integer, String>> q = new LinkedList<>();

    public boolean shouldPrintMessage(int timestamp, String message) {
        // garbage collect
        while (!q.isEmpty() && q.peek().k <= timestamp - 10) {
            var v = q.poll();
            s.remove(v.v);
        }

        if (s.contains(message)) {
            return false;
        } else {
            q.add(new Pair<>(timestamp, message));
            s.add(message);
            return true;
        }
    }
}
```
