---
title: "Missing Number"
date: 2024-07-24Z-0700
leetcode: true
---

## Problem

Given an array nums containing n distinct numbers in the range [0, n], return the only number in the range that is missing from the array.

Example 1:

```text
Input: nums = [3,0,1]
Output: 2
Explanation: n = 3 since there are 3 numbers, so all numbers are in the range [0,3]. 2 is the missing number in the range since it does not appear in nums.
```

Example 2:

```text
Input: nums = [0,1]
Output: 2
Explanation: n = 2 since there are 2 numbers, so all numbers are in the range [0,2]. 2 is the missing number in the range since it does not appear in nums.
```

Example 3:

```text
Input: nums = [9,6,4,2,3,5,7,0,1]
Output: 8
Explanation: n = 9 since there are 9 numbers, so all numbers are in the range [0,9]. 8 is the missing number in the range since it does not appear in nums.
```

Constraints:

- n == nums.length
- 1 <= n <= 104
- 0 <= nums[i] <= n
- All the numbers of nums are unique.

Follow up: Could you implement a solution using only O(1) extra space complexity and O(n) runtime complexity?

## Solution

### Cyclic Sort

```java
class Solution {
    public int missingNumber(int[] nums) {
        var i = 0;
        var n = nums.length;

        while (i < nums.length) {
            if (nums[i] == i || nums[i] >= nums.length) {
                i++;
            } else {
                swap(nums, nums[i], i);
            }
        }

        for (i = 0; i < nums.length; i++) {
            if (nums[i] != i) {
                return i;
            }
        }

        return nums.length;
    }

    void swap(int[] a, int x, int y) {
        a[x] ^= a[y];
        a[y] ^= a[x];
        a[x] ^= a[y];
    }
}
```

### XOR

Another use for that XOR trick!

```java
class Solution {
    public int missingNumber(int[] nums) {
        int max = nums.length;
        int n = 0;

        for (int i = 0; i <= max; i++) {
            n = n ^ i;
        }

        for (var i : nums) {
            n = n ^ i;
        }

        return n;
    }
}
```
