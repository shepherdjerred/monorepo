---
title: "First Missing Positive"
date: 2024-08-05Z-0700
leetcode: true
---

## Problem

Given an unsorted integer array nums. Return the smallest positive integer that is not present in nums.

You must implement an algorithm that runs in O(n) time and uses O(1) auxiliary space.

Example 1:

```text
Input: nums = [1,2,0]
Output: 3
Explanation: The numbers in the range [1,2] are all in the array.
```

Example 2:

```text
Input: nums = [3,4,-1,1]
Output: 2
Explanation: 1 is in the array but 2 is missing.
```

Example 3:

```text
Input: nums = [7,8,9,11,12]
Output: 1
Explanation: The smallest positive integer 1 is missing.
```

Constraints:

- 1 <= nums.length <= 105
- -231 <= nums[i] <= 231 - 1

## Solution

### Another Cyclic Sort

```java
class Solution {
    public int firstMissingPositive(int[] nums) {
        var i = 0;
        while (i < nums.length) {
            if (nums[i] > 0 && nums[i] <= nums.length && nums[i] != nums[nums[i] - 1]) {
                swap(nums, i, nums[i] - 1);
            } else {
                i += 1;
            }
        }

        for (i = 0; i < nums.length; i++) {
            if (nums[i] != i + 1) {
                return i + 1;
            }
        }

        return nums.length + 1;
    }

    void swap(int[] nums, int l, int r) {
        nums[l] ^= nums[r];
        nums[r] ^= nums[l];
        nums[l] ^= nums[r];
    }
}
```

### Cyclic Sort

```java
class Solution {
    public int firstMissingPositive(int[] nums) {
        // cyclic sort
        var i = 0;
        while (i < nums.length) {
            var dst = nums[i] - 1;
            if (nums[i] > 0 && nums[i] <= nums.length && nums[i] != nums[dst]) {
                swap(nums, i, dst);
            } else {
                i += 1;
            }
        }

        for (i = 0; i < nums.length; i++) {
            if (nums[i] != i + 1) {
                return i + 1;
            }
        }

        return nums.length + 1;
    }

    void swap(int[] nums, int x, int y) {
        var tmp = nums[x];
        nums[x] = nums[y];
        nums[y] = tmp;
    }
}
```

### XOR

This didn't work because the array allows duplicate numbers :/

```java
class Solution {
    public int firstMissingPositive(int[] nums) {
        var x = 0;
        var min = Integer.MAX_VALUE;
        var max = Integer.MIN_VALUE;
        for (var n : nums) {
            if (n < 1) {
                continue;
            }
            min = Math.min(min, n);
            max = Math.max(max, n);
            x ^= n;
        }
        if (min > 1) {
            return 1;
        }
        for (var i = min; i <= max; i++) {
            x ^= i;
        }
        if (x == 0) {
            return max + 1;
        }
        return x;
    }
}
```
