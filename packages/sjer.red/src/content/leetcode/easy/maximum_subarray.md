---
title: "Maximum Subarray"
date: 2024-07-21Z-0700
leetcode: true
---

## Problem

Given an integer array nums, find the subarray with the largest sum, and return its sum.

Example 1:

```text
Input: nums = [-2,1,-3,4,-1,2,1,-5,4]
Output: 6
Explanation: The subarray [4,-1,2,1] has the largest sum 6.
```

Example 2:

```text
Input: nums = [1]
Output: 1
Explanation: The subarray [1] has the largest sum 1.
```

Example 3:

```text
Input: nums = [5,4,-1,7,8]
Output: 23
Explanation: The subarray [5,4,-1,7,8] has the largest sum 23.
```

Constraints:

- 1 <= nums.length <= 105
- -104 <= nums[i] <= 104

Follow up: If you have figured out the O(n) solution, try coding another solution using the divide and conquer approach, which is more subtle.

## Solution

Maybe I just really don't understand what dynamic programming is.

```java
class Solution {
    public int maxSubArray(int[] nums) {
        var curr = 0;
        var max = Integer.MIN_VALUE;

        for (var i : nums) {
            curr += i;
            max = Math.max(curr, max);
            if (curr < 0) {
                curr = 0;
            }
        }

        return max;
    }
}
```
