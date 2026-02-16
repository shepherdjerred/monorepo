---
title: "Make Two Arrays Equal by Reversing Subarrays"
date: 2024-08-03Z-0700
leetcode: true
---

## Problem

You are given two integer arrays of equal length target and arr. In one step, you can select any non-empty subarray of arr and reverse it. You are allowed to make any number of steps.

Return true if you can make arr equal to target or false otherwise.

Example 1:

```text
Input: target = [1,2,3,4], arr = [2,4,1,3]
Output: true
Explanation: You can follow the next steps to convert arr to target:
1- Reverse subarray [2,4,1], arr becomes [1,4,2,3]
2- Reverse subarray [4,2], arr becomes [1,2,4,3]
3- Reverse subarray [4,3], arr becomes [1,2,3,4]
There are multiple ways to convert arr to target, this is not the only way to do so.
```

Example 2:

```text
Input: target = [7], arr = [7]
Output: true
Explanation: arr is equal to target without any reverses.
```

Example 3:

```text
Input: target = [3,7,9], arr = [3,7,11]
Output: false
Explanation: arr does not have value 9 and it can never be converted to target.
```

Constraints:

- target.length == arr.length
- 1 <= target.length <= 1000
- 1 <= target[i] <= 1000
- 1 <= arr[i] <= 1000

## Solution

```java
class Solution {
    public boolean canBeEqual(int[] target, int[] arr) {
        var f = new int[1001];
        var set = 0;
        for (int i = 0; i < target.length; i++) {
            if (f[target[i]] == 0) {
                set += 1;
            }
            f[target[i]] += 1;
        }

        for (int i = 0; i < arr.length; i++) {
            f[arr[i]] -= 1;
            if (f[arr[i]] == 0) {
                set -= 1;
            }
        }

        return set == 0;
    }
}
```
