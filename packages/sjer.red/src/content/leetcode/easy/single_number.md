---
title: "Single Number"
date: 2024-06-12Z-0700
leetcode: true
---

## Problem

Given a non-empty array of integers nums, every element appears twice except for one. Find that single one.

You must implement a solution with a linear runtime complexity and use only constant extra space.

Example 1:

```text
Input: nums = [2,2,1]
Output: 1
Example 2:

Input: nums = [4,1,2,1,2]
Output: 4
Example 3:

Input: nums = [1]
Output: 1
```

Constraints:

- 1 <= nums.length <= 3 \* 10^4
- -3 _10^4 <= nums[i] <= 3_ 10^4
- Each element in the array appears twice except for one element which appears only once.

## Solution

Relies on [that xor trick](https://florian.github.io/xor-trick/). [Related](https://www.mattkeeter.com/blog/2022-12-10-xor/).

```java
class Solution {
    public int singleNumber(int[] nums) {
        var counter = 0;
        for (var n : nums) {
            counter ^= n;
        }
        return counter;
    }
}
```
