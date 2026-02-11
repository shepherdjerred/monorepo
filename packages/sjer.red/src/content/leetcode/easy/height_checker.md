---
title: "Height Checker"
date: 2024-08-03Z-0700
leetcode: true
---

## Problem

A school is trying to take an annual photo of all the students. The students are asked to stand in a single file line in non-decreasing order by height. Let this ordering be represented by the integer array expected where expected[i] is the expected height of the ith student in line.

You are given an integer array heights representing the current order that the students are standing in. Each heights[i] is the height of the ith student in line (0-indexed).

Return the number of indices where heights[i] != expected[i].

Example 1:

```text
Input: heights = [1,1,4,2,1,3]
Output: 3
Explanation:
heights:  [1,1,4,2,1,3]
expected: [1,1,1,2,3,4]
Indices 2, 4, and 5 do not match.
```

Example 2:

```text
Input: heights = [5,1,2,3,4]
Output: 5
Explanation:
heights:  [5,1,2,3,4]
expected: [1,2,3,4,5]
All indices do not match.
```

Example 3:

```text
Input: heights = [1,2,3,4,5]
Output: 0
Explanation:
heights:  [1,2,3,4,5]
expected: [1,2,3,4,5]
All indices match.
```

Constraints:

- 1 <= heights.length <= 100
- 1 <= heights[i] <= 100

## Solution

Time: O(n)
Space: O(1)

```java
class Solution {
    public int heightChecker(int[] heights) {
        var cnts = new int[101];
        for (var h : heights) {
            cnts[h] += 1;
        }
        var idx = 0;
        var sorted = new int[heights.length];
        var diffs = 0;
        for (var i = 0; i < sorted.length; i++) {
            while (cnts[idx] == 0) {
                idx += 1;
            }
            sorted[i] = idx;
            cnts[idx] -= 1;

            if (sorted[i] != heights[i]) {
                diffs += 1;
            }
        }

        return diffs;
    }
}
```
