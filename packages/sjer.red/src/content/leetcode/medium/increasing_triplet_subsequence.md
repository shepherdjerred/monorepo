---
title: "Increasing Triplet Subsequence"
date: 2024-08-03Z-0700
leetcode: true
---

## Problem

Given an integer array nums, return true if there exists a triple of indices (i, j, k) such that i < j < k and nums[i] < nums[j] < nums[k]. If no such indices exists, return false.

Example 1:

```text
Input: nums = [1,2,3,4,5]
Output: true
Explanation: Any triplet where i < j < k is valid.
```

Example 2:

```text
Input: nums = [5,4,3,2,1]
Output: false
Explanation: No triplet exists.
```

Example 3:

```text
Input: nums = [2,1,5,0,4,6]
Output: true
Explanation: The triplet (3, 4, 5) is valid because nums[3] == 0 < nums[4] == 4 < nums[5] == 6.
```

Constraints:

- 1 <= nums.length <= 5 \* 105
- -231 <= nums[i] <= 231 - 1

Follow up: Could you implement a solution that runs in O(n) time complexity and O(1) space complexity?

## Solution

```java
class Solution {
    public boolean increasingTriplet(int[] nums) {
        var one = Integer.MAX_VALUE;
        var two = Integer.MAX_VALUE;
        for (var n : nums) {
            if (n <= one) {
                one = n;
            } else if (n <= two) {
                two = n;
            } else {
                return true;
            }
        }
        return false;
    }
}
```
