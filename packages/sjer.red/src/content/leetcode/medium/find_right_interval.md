---
title: "Find Right Interval"
date: 2024-08-09Z-0700
leetcode: true
---

## Problem

You are given an array of intervals, where intervals[i] = [starti, endi] and each starti is unique.

The right interval for an interval i is an interval j such that startj >= endi and startj is minimized. Note that i may equal j.

Return an array of right interval indices for each interval i. If no right interval exists for interval i, then put -1 at index i.

Example 1:

```text
Input: intervals = [[1,2]]
Output: [-1]
Explanation: There is only one interval in the collection, so it outputs -1.
```

Example 2:

```text
Input: intervals = [[3,4],[2,3],[1,2]]
Output: [-1,0,1]
Explanation: There is no right interval for [3,4].
The right interval for [2,3] is [3,4] since start0 = 3 is the smallest start that is >= end1 = 3.
The right interval for [1,2] is [2,3] since start1 = 2 is the smallest start that is >= end2 = 2.
```

Example 3:

```text
Input: intervals = [[1,4],[2,3],[3,4]]
Output: [-1,2,-1]
Explanation: There is no right interval for [1,4] and [3,4].
The right interval for [2,3] is [3,4] since start2 = 3 is the smallest start that is >= end1 = 3.
```

Constraints:

- 1 <= intervals.length <= 2 \* 104
- intervals[i].length == 2
- -106 <= starti <= endi <= 106
- The start point of each interval is unique.

## Solution

```java
class Solution {
    public int[] findRightInterval(int[][] intervals) {
        var start = new PriorityQueue<Integer>((l, r) -> {
            return Integer.compare(intervals[l][0], intervals[r][0]);
        });
        var end = new PriorityQueue<Integer>((l, r) -> {
            return Integer.compare(intervals[l][1], intervals[r][1]);
        });
        for (int i = 0; i < intervals.length; i++) {
            end.offer(i);
            start.offer(i);
        }

        var ans = new int[intervals.length];
        Arrays.fill(ans, -1);

        while (!end.isEmpty()) {
            while (!start.isEmpty() && intervals[end.peek()][1] > intervals[start.peek()][0]) {
                start.poll();
            }
            if (start.isEmpty()) {
                break;
            }
            ans[end.poll()] = start.peek();
        }

        return ans;
    }
}
```
