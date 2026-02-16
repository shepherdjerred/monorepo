---
title: "Maximum Average Subarray I"
date: 2024-08-02Z-0700
leetcode: true
---

## Problem

You are given an integer array nums consisting of n elements, and an integer k.

Find a contiguous subarray whose length is equal to k that has the maximum average value and return this value. Any answer with a calculation error less than 10-5 will be accepted.

Example 1:

```text
Input: nums = [1,12,-5,-6,50,3], k = 4
Output: 12.75000
Explanation: Maximum average is (12 - 5 - 6 + 50) / 4 = 51 / 4 = 12.75
```

Example 2:

```text
Input: nums = [5], k = 1
Output: 5.00000
```

Constraints:

- n == nums.length
- 1 <= k <= n <= 105
- -104 <= nums[i] <= 104

## Solution

```java
class Solution {
    public double findMaxAverage(int[] nums, int k) {
        var max = (double) Integer.MIN_VALUE;
        var sum = 0;
        // read in the first k - 1 numbers
        for (var i = 0; i < k - 1; i++) {
            sum += nums[i];
        }
        for (var i = k - 1; i < nums.length; i++) {
            sum += nums[i];
            max = Math.max(sum / (double) k, max);
            // clean slate for the next iteration
            sum -= nums[i - (k - 1)];
        }
        return max;
    }
}
```
