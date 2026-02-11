---
title: "Search Insert Position"
date: 2024-08-03Z-0700
leetcode: true
---

## Problem

Given a sorted array of distinct integers and a target value, return the index if the target is found. If not, return the index where it would be if it were inserted in order.

You must write an algorithm with O(log n) runtime complexity.

Example 1:

```java
Input: nums = [1,3,5,6], target = 5
Output: 2
```

Example 2:

```java
Input: nums = [1,3,5,6], target = 2
Output: 1
```

Example 3:

```java
Input: nums = [1,3,5,6], target = 7
Output: 4
```

Constraints:

- 1 <= nums.length <= 104
- -104 <= nums[i] <= 104
- nums contains distinct values sorted in ascending order.
- -104 <= target <= 104

## Solution

```java
class Solution {
    public int searchInsert(int[] nums, int target) {
        var left = 0;
        var right = nums.length - 1;

        while (left <= right) {
            var middle = left + ((right - left) / 2);
            var n = nums[middle];
            if (n == target) {
                return middle;
            } else if (n < target) {
                // check the right half
                left = middle + 1;
            } else {
                // check the left half
                right = middle - 1;
            }
        }

        return left;
    }
}
```

## Standard Library

```java
class Solution {
    public int searchInsert(int[] nums, int target) {
        var pos = Arrays.binarySearch(nums, target);
        if (pos < 0) {
            pos = (pos + 1) * -1;
        }
        return pos;
    }
}
```
