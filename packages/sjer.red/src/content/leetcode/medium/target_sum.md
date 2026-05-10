---
title: "Target Sum"
date: 2024-07-28Z-0700
leetcode: true
---

## Problem

You are given an integer array nums and an integer target.

You want to build an expression out of nums by adding one of the symbols '+' and '-' before each integer in nums and then concatenate all the integers.

- For example, if nums = [2, 1], you can add a '+' before 2 and a '-' before 1 and concatenate them to build the expression "+2-1".

Return the number of different expressions that you can build, which evaluates to target.

Example 1:

```text
Input: nums = [1,1,1,1,1], target = 3
Output: 5
Explanation: There are 5 ways to assign symbols to make the sum of nums be target 3.
-1 + 1 + 1 + 1 + 1 = 3
+1 - 1 + 1 + 1 + 1 = 3
+1 + 1 - 1 + 1 + 1 = 3
+1 + 1 + 1 - 1 + 1 = 3
+1 + 1 + 1 + 1 - 1 = 3
```

Example 2:

```text
Input: nums = [1], target = 1
Output: 1
```

Constraints:

- 1 <= nums.length <= 20
- 0 <= nums[i] <= 1000
- 0 <= sum(nums[i]) <= 1000
- -1000 <= target <= 1000

## Solution

There are better solutions using dynamic programming.

Time: O(2^n)
Space: O(n)

```java
class Solution {
    public int findTargetSumWays(int[] nums, int target) {
        return findTargetSumWays(nums, 0, 0, target);
    }

    public int findTargetSumWays(int[] nums, int i, int curr, int target) {
        // base case
        if (i == nums.length) {
            if (curr == target) {
                return 1;
            }
            return 0;
        }

        return findTargetSumWays(nums, i + 1, curr + nums[i], target)
          + findTargetSumWays(nums, i + 1, curr - nums[i], target);
    }
}
```
