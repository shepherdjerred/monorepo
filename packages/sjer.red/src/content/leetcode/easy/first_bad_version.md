---
title: "First Bad Version"
date: 2024-07-20Z-0700
leetcode: true
---

## Problem

You are a product manager and currently leading a team to develop a new product. Unfortunately, the latest version of your product fails the quality check. Since each version is developed based on the previous version, all the versions after a bad version are also bad.

Suppose you have n versions [1, 2, ..., n] and you want to find out the first bad one, which causes all the following ones to be bad.

You are given an API bool isBadVersion(version) which returns whether version is bad. Implement a function to find the first bad version. You should minimize the number of calls to the API.

Example 1:

```text
Input: n = 5, bad = 4
Output: 4
Explanation:
call isBadVersion(3) -> false
call isBadVersion(5) -> true
call isBadVersion(4) -> true
Then 4 is the first bad version.
```

Example 2:

```text
Input: n = 1, bad = 1
Output: 1
```

Constraints:

- 1 <= bad <= n <= 231 - 1

## Solution

This sounds similar to `git bisect`.

```java
/* The isBadVersion API is defined in the parent class VersionControl.
      boolean isBadVersion(int version); */

public class Solution extends VersionControl {
    public int firstBadVersion(int n) {
        return firstBadVersion(1, n);
    }

    public int firstBadVersion(int min, int max) {
        if (min == max) {
            return min;
        }
        var middle = min + ((max - min) / 2);
        if (isBadVersion(middle)) {
            return firstBadVersion(min, middle);
        } else {
            return firstBadVersion(middle + 1, max);
        }
    }
}
```
