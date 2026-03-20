---
title: "Move Zeroes"
date: 2024-06-13Z-0700
leetcode: true
---

## Problem

Given an integer array nums, move all 0's to the end of it while maintaining the relative order of the non-zero elements.

Note that you must do this in-place without making a copy of the array.

Example 1:

```text
Input: nums = [0,1,0,3,12]
Output: [1,3,12,0,0]
```

Example 2:

```text
Input: nums = [0]
Output: [0]
```

Constraints:

- 1 <= nums.length <= 10^4
- -2^31 <= nums[i] <= 2^31 - 1

Follow up: Could you minimize the total number of operations done?

## Solution

O(n) time/space solution. Sloppy code, though.

```java
class Solution {
    public void moveZeroes(int[] nums) {
        var firstSlot = -1;

        for (int i = 0; i < nums.length; i++) {
            if (nums[i] == 0) {
                firstSlot = i;
                break;
            }
        }

        if (firstSlot == -1) {
            return;
        }

        var nextSlot = firstSlot;
        for (int i = 0; i < nums.length; i++) {
            if (i < firstSlot) {
                continue;
            }

            if (nums[i] != 0) {
                nums[nextSlot] = nums[i];
                nums[i] = 0;
                nextSlot += 1;
            }
        }
    }
}
```
