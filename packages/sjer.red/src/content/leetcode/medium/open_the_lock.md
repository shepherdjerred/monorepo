---
title: "Open the Lock"
date: 2024-08-08Z-0700
leetcode: true
---

## Problem

You have a lock in front of you with 4 circular wheels. Each wheel has 10 slots: '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'. The wheels can rotate freely and wrap around: for example we can turn '9' to be '0', or '0' to be '9'. Each move consists of turning one wheel one slot.

The lock initially starts at '0000', a string representing the state of the 4 wheels.

You are given a list of deadends dead ends, meaning if the lock displays any of these codes, the wheels of the lock will stop turning and you will be unable to open it.

Given a target representing the value of the wheels that will unlock the lock, return the minimum total number of turns required to open the lock, or -1 if it is impossible.

Example 1:

```text
Input: deadends = ["0201","0101","0102","1212","2002"], target = "0202"
Output: 6
Explanation:
A sequence of valid moves would be "0000" -> "1000" -> "1100" -> "1200" -> "1201" -> "1202" -> "0202".
Note that a sequence like "0000" -> "0001" -> "0002" -> "0102" -> "0202" would be invalid,
because the wheels of the lock become stuck after the display becomes the dead end "0102".
```

Example 2:

```text
Input: deadends = ["8888"], target = "0009"
Output: 1
Explanation: We can turn the last wheel in reverse to move from "0000" -> "0009".
```

Example 3:

```text
Input: deadends = ["8887","8889","8878","8898","8788","8988","7888","9888"], target = "8888"
Output: -1
Explanation: We cannot reach the target without getting stuck.
```

Constraints:

- 1 <= deadends.length <= 500
- deadends[i].length == 4
- target.length == 4
- target will not be in the list deadends.
- target and deadends[i] consist of digits only.

## Solution

### Bidirectional Search

Time: O(b^d/2) where b = branching factor, d = distance of shortest path
Space: O(b^d/2)

```java
class Solution {
    public String turnNext(String s, int pos) {
        var i = s.charAt(pos) - '0';
        int next;
        if (i == 9) {
            next = 0;
        } else {
            next = i + 1;
        }
        var sb = new StringBuilder(s);
        sb.setCharAt(pos, (char) (next + '0'));
        return sb.toString();
    }

    public String turnPrev(String s, int pos) {
        var i = s.charAt(pos) - '0';
        int prev;
        if (i == 0) {
            prev = 9;
        } else {
            prev = i - 1;
        }
        var sb = new StringBuilder(s);
        sb.setCharAt(pos, (char) (prev + '0'));
        return sb.toString();
    }

    public int openLock(String[] deadends, String target) {
        var q1 = new LinkedList<String>();
        var visited1 = new HashSet<String>(Arrays.asList(deadends));
        var turns1 = 0;
        var q2 = new LinkedList<String>();
        var visited2 = new HashSet<String>(Arrays.asList(deadends));
        var turns2 = 0;
        var initial = "0000";

        if (visited1.contains(initial)) {
            return -1;
        }

        q1.add(initial);
        visited1.add(initial);

        q2.add(target);
        visited2.add(target);

        while (!q1.isEmpty() || !q2.isEmpty()) {
            var count1 = q1.size();
            for (var i = 0; i < count1; i++) {
                var s = q1.poll();

                if (visited2.contains(s)) {
                    return turns1 + turns2;
                }

                // add all possible combinations
                for (var x = 0; x < 4; x++) {
                    var next = turnNext(s, x);
                    if (!visited1.contains(next)) {
                        q1.offer(next);
                        visited1.add(next);
                    }
                    var prev = turnPrev(s, x);
                    if (!visited1.contains(prev)) {
                        q1.offer(prev);
                        visited1.add(prev);
                    }
                }
            }
            turns1 += 1;

            var count2 = q2.size();
            for (var i = 0; i < count2; i++) {
                var s = q2.poll();

                if (visited1.contains(s)) {
                    return turns1 + turns2;
                }

                // add all possible combinations
                for (var x = 0; x < 4; x++) {
                    var next = turnNext(s, x);
                    if (!visited2.contains(next)) {
                        q2.offer(next);
                        visited2.add(next);
                    }
                    var prev = turnPrev(s, x);
                    if (!visited2.contains(prev)) {
                        q2.offer(prev);
                        visited2.add(prev);
                    }
                }
            }
            turns2 += 1;
        }

        return -1;
    }
}
```

### BFS

```java
class Solution {
    public String turnNext(String s, int pos) {
        var i = s.charAt(pos) - '0';
        int next;
        if (i == 9) {
            next = 0;
        } else {
            next = i + 1;
        }
        var sb = new StringBuilder(s);
        sb.setCharAt(pos, (char) (next + '0'));
        return sb.toString();
    }

    public String turnPrev(String s, int pos) {
        var i = s.charAt(pos) - '0';
        int prev;
        if (i == 0) {
            prev = 9;
        } else {
            prev = i - 1;
        }
        var sb = new StringBuilder(s);
        sb.setCharAt(pos, (char) (prev + '0'));
        return sb.toString();
    }

    public int openLock(String[] deadends, String target) {
        var q = new LinkedList<String>();
        var visited = new HashSet<String>(Arrays.asList(deadends));
        var turns = 0;
        var initial = "0000";

        if (visited.contains(initial)) {
            return -1;
        }

        q.add(initial);
        visited.add(initial);

        while (!q.isEmpty()) {
            var count = q.size();
            for (var i = 0; i < count; i++) {
                var s = q.poll();

                if (s.equals(target)) {
                    return turns;
                }

                // add all possible combinations
                for (var x = 0; x < 4; x++) {
                    var next = turnNext(s, x);
                    if (!visited.contains(next)) {
                        q.offer(next);
                        visited.add(next);
                    }
                    var prev = turnPrev(s, x);
                    if (!visited.contains(prev)) {
                        q.offer(prev);
                        visited.add(prev);
                    }
                }
            }
            turns += 1;
        }

        return -1;
    }
}
```
