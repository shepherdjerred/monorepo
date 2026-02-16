---
title: "Longest Harmonious Subsequence"
date: 2024-08-02Z-0700
leetcode: true
---

## Problem

We define a harmonious array as an array where the difference between its maximum value and its minimum value is exactly 1.

Given an integer array nums, return the length of its longest harmonious subsequence among all its possible subsequences.

A subsequence of array is a sequence that can be derived from the array by deleting some or no elements without changing the order of the remaining elements.

Example 1:

```text
Input: nums = [1,3,2,2,5,2,3,7]
Output: 5
Explanation: The longest harmonious subsequence is [3,2,2,2,3].
```

Example 2:

```text
Input: nums = [1,2,3,4]
Output: 2
```

Example 3:

```text
Input: nums = [1,1,1,1]
Output: 0
```

Constraints:

- 1 <= nums.length <= 2 \* 104
- -109 <= nums[i] <= 109

## Solution

Time: O(n)

Space: O(n)

```java
class Solution {
    public int findLHS(int[] nums) {
        var max = 0;
        // key: number
        // value: frequency
        var m = new HashMap<Integer, Integer>();

        // create the frequency map
        for (var n : nums) {
            m.merge(n, 1, Integer::sum);
        }

        // iterate over unique numbers
        for (var n : m.keySet()) {
            if (m.containsKey(n + 1)) {
                var sum = m.get(n) + m.get(n + 1);
                max = Integer.max(max, sum);
            }
        }

        return max;
    }
}
```

### One-pass

This is a modification of the above solution to complete the task in just one pass of the array.

```java
class Solution {
    public int findLHS(int[] nums) {
        var max = 0;
        // key: number
        // value: frequency
        var m = new HashMap<Integer, Integer>();

        for (var n : nums) {
            m.merge(n, 1, Integer::sum);
            if (m.containsKey(n + 1)) {
                var sum = m.get(n) + m.get(n + 1);
                max = Integer.max(max, sum);
            }
            if (m.containsKey(n - 1)) {
                var sum = m.get(n) + m.get(n - 1);
                max = Integer.max(max, sum);
            }
        }

        return max;
    }
}
```
