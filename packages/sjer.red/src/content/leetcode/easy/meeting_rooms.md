---
title: "Meeting Rooms"
date: 2024-08-06Z-0700
leetcode: true
---

## Problem

Given an array of meeting time intervals where intervals[i] = [starti, endi], determine if a person could attend all meetings.

Example 1:

```text
Input: intervals = [[0,30],[5,10],[15,20]]
Output: false
```

Example 2:

```text
Input: intervals = [[7,10],[2,4]]
Output: true
```

Constraints:

- 0 <= intervals.length <= 104
- intervals[i].length == 2
- 0 <= starti < endi <= 106

## Solution

```java
class Solution {
    public boolean canAttendMeetings(int[][] intervals) {
        Arrays.sort(intervals, (l, r) -> {
            return Integer.compare(l[0], r[0]);
        });
        var t = -1;
        for (var i : intervals) {
            if (t > i[0]) {
                // conflict
                return false;
            } else {
                t = i[1];
            }
        }

        return true;
    }
}
```
