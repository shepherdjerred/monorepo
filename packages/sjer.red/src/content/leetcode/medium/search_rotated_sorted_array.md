---
title: "Search in Rotated Sorted Array"
date: 2024-08-04Z-0700
leetcode: true
---

## Problem

There is an integer array nums sorted in ascending order (with distinct values).

Prior to being passed to your function, nums is possibly rotated at an unknown pivot index k (1 <= k < nums.length) such that the resulting array is [nums[k], nums[k+1], ..., nums[n-1], nums[0], nums[1], ..., nums[k-1]] (0-indexed). For example, [0,1,2,4,5,6,7] might be rotated at pivot index 3 and become [4,5,6,7,0,1,2].

Given the array nums after the possible rotation and an integer target, return the index of target if it is in nums, or -1 if it is not in nums.

You must write an algorithm with O(log n) runtime complexity.

Example 1:

```text
Input: nums = [4,5,6,7,0,1,2], target = 0
Output: 4
```

Example 2:

```text
Input: nums = [4,5,6,7,0,1,2], target = 3
Output: -1
```

Example 3:

```text
Input: nums = [1], target = 0
Output: -1
```

Constraints:

- 1 <= nums.length <= 5000
- -104 <= nums[i] <= 104
- All values of nums are unique.
- nums is an ascending array that is possibly rotated.
- -104 <= target <= 104

## Solution

```java
class Solution {
    public int search(int[] nums, int target) {
        var left = 0;
        var right = nums.length;
        var middle = 0;

        while (left <= right) {
            middle = left + (right - left) / 2;
            if (nums[middle] <= nums[nums.length - 1]) {
                right = middle - 1;
            } else {
                left = middle + 1;
            }
        }

        var pivot = left;

        // now do a modified binary search
        left = pivot;
        right = left + nums.length - 1;

        while (left <= right) {
            middle = left + (right - left) / 2;
            var idx = middle % nums.length;
            var n = nums[idx];
            if (n == target) {
                return idx;
            } else if (n < target)  {
                left = middle + 1;
            } else {
                right = middle - 1;
            }
        }

        return -1;
    }
}
```
