---
title: "Left and Right Sum Differences"
date: 2024-08-07Z-0700
leetcode: true
---

## Problem

Given a 0-indexed integer array nums, find a 0-indexed integer array answer where:

- answer.length == nums.length.
- answer[i] = |leftSum[i] - rightSum[i]|.

Where:

- leftSum[i] is the sum of elements to the left of the index i in the array nums. If there is no such element, leftSum[i] = 0.
- rightSum[i] is the sum of elements to the right of the index i in the array nums. If there is no such element, rightSum[i] = 0.

Return the array answer.

Example 1:

```text
Input: nums = [10,4,8,3]
Output: [15,1,11,22]
Explanation: The array leftSum is [0,10,14,22] and the array rightSum is [15,11,3,0].
The array answer is [|0 - 15|,|10 - 11|,|14 - 3|,|22 - 0|] = [15,1,11,22].
```

Example 2:

```text
Input: nums = [1]
Output: [0]
Explanation: The array leftSum is [0] and the array rightSum is [0].
The array answer is [|0 - 0|] = [0].
```

Constraints:

- 1 <= nums.length <= 1000
- 1 <= nums[i] <= 105

## Solution

### One Pass

```java
class Solution {
    public int[] leftRightDifference(int[] nums) {
        var ans = new int[nums.length];
        var lsum = 0;
        var rsum = 0;
        var isOdd = nums.length % 2 == 1;
        var half = nums.length / 2;
        for (var i = 0; i < nums.length; i++) {
            // left side
            ans[i] = Math.abs(ans[i] + lsum);
            lsum += nums[i];

            // right side
            var opp = nums.length - i - 1;
            if ((isOdd && opp <= half) || opp < half) {
                ans[opp] = Math.abs(ans[opp] - rsum);
            } else {
                ans[opp] = ans[opp] - rsum;
            }
            rsum += nums[opp];
        }
        return ans;
    }
}
```
