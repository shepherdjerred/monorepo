---
title: "Contains Duplicate II"
date: 2024-08-02Z-0700
leetcode: true
---

## Problem

Given an integer array nums and an integer k, return true if there are two distinct indices i and j in the array such that nums[i] == nums[j] and abs(i - j) <= k.

Example 1:

```text
Input: nums = [1,2,3,1], k = 3
Output: true
```

Example 2:

```text
Input: nums = [1,0,1,1], k = 1
Output: true
```

Example 3:

```text
Input: nums = [1,2,3,1,2,3], k = 2
Output: false
```

Constraints:

- 1 <= nums.length <= 105
- -109 <= nums[i] <= 109
- 0 <= k <= 105

## Solution

Time: O(n)
Space: O(n)

```java
class Solution {
    public boolean containsNearbyDuplicate(int[] nums, int k) {
        // key: number
        // value: monotonic index
        var m = new HashMap<Integer, Integer>();

        for (var i = 0; i < nums.length; i++) {
            var n = nums[i];
            if (m.containsKey(n)) {
                if (Math.abs(m.get(n) - i) <= k) {
                    return true;
                }
            }
            m.put(n, i);
        }

        return false;
    }
}
```
