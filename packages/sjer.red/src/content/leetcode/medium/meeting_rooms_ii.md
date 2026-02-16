---
title: "Meeting Rooms II"
date: 2024-08-06Z-0700
leetcode: true
---

## Problem

Given an array of meeting time intervals intervals where intervals[i] = [starti, endi], return the minimum number of conference rooms required.

Example 1:

```text
Input: intervals = [[0,30],[5,10],[15,20]]
Output: 2
```

Example 2:

```text
Input: intervals = [[7,10],[2,4]]
Output: 1
```

Constraints:

- 1 <= intervals.length <= 104
- 0 <= starti < endi <= 106

## Solution

### Sort

```java
class Solution {
    public int minMeetingRooms(int[][] intervals) {
        var start = Arrays.copyOf(intervals, intervals.length);
        var end = Arrays.copyOf(intervals, intervals.length);

        Arrays.sort(start, (l, r) -> {
            return Integer.compare(l[0], r[0]);
        });

        Arrays.sort(end, (l, r) -> {
            return Integer.compare(l[1], r[1]);
        });

        var startP = 0;
        var endP = 0;
        var rooms = 0;

        while (startP < start.length) {
            if (start[startP][0] >= end[endP][1]) {
                rooms -= 1;
                endP += 1;
            }

            rooms += 1;
            startP += 1;
        }

        return rooms;
    }
}
```

### Sort + Heap

```java
class Solution {
    public int minMeetingRooms(int[][] intervals) {
        // sort input by start
        Arrays.sort(intervals, (l, r) -> {
            return Integer.compare(l[0], r[0]);
        });
        // pq by end
        var pq = new PriorityQueue<int[]>((l, r) -> {
            return Integer.compare(l[1], r[1]);
        });
        var rooms = 0;
        for (var i = 0; i < intervals.length; i++) {
            // remove meetings that have ended
            while (!pq.isEmpty() && pq.peek()[1] <= intervals[i][0]) {
                pq.poll();
            }

            pq.offer(intervals[i]);
            rooms = Math.max(rooms, pq.size());
        }
        return rooms;
    }
}
```
