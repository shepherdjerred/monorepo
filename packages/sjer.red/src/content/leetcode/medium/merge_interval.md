---
title: "Merge Intervals"
date: 2024-08-05Z-0700
leetcode: true
---

## Problem

Given an array of intervals where intervals[i] = [starti, endi], merge all overlapping intervals, and return an array of the non-overlapping intervals that cover all the intervals in the input.

Example 1:

```text
Input: intervals = [[1,3],[2,6],[8,10],[15,18]]
Output: [[1,6],[8,10],[15,18]]
Explanation: Since intervals [1,3] and [2,6] overlap, merge them into [1,6].
```

Example 2:

```text
Input: intervals = [[1,4],[4,5]]
Output: [[1,5]]
Explanation: Intervals [1,4] and [4,5] are considered overlapping.
```

Constraints:

- 1 <= intervals.length <= 104
- intervals[i].length == 2
- 0 <= starti <= endi <= 104

## Solution

```java
class Solution {
    public int[][] merge(int[][] intervals) {
        var ans = new ArrayList<int[]>();
        Arrays.sort(intervals, (l, r) -> {
            return Integer.compare(l[0], r[0]);
        });
        ans.add(intervals[0]);
        for (var i = 0; i < intervals.length; i++) {
            var last = ans.get(ans.size() - 1);
            if ((intervals[i][0] <= last[0] && last[0] <= intervals[i][1]) || (last[0] <= intervals[i][0] && intervals[i][0] <= last[1])) {
                // overlap; merge
                last[0] = Math.min(last[0], intervals[i][0]);
                last[1] = Math.max(last[1], intervals[i][1]);
            } else {
                // no overlap; add
                ans.add(intervals[i]);
            }
        }
        var answer = new int[ans.size()][2];

        for (int i = 0; i < ans.size(); i++) {
            answer[i][0] = ans.get(i)[0];
            answer[i][1] = ans.get(i)[1];
        }
        return answer;
    }
}
```
