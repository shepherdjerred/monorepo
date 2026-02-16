---
title: "Count Primes"
date: 2024-07-24Z-0700
leetcode: true
---

## Problem

Given an integer n, return the number of prime numbers that are strictly less than n.

Example 1:

```text
Input: n = 10
Output: 4
Explanation: There are 4 prime numbers less than 10, they are 2, 3, 5, 7.
```

Example 2:

```text
Input: n = 0
Output: 0
```

Example 3:

```text
Input: n = 1
Output: 0
```

Constraints:

- 0 <= n <= 5 \* 106

## Solution

I will walk out of any interview that wants me to implement or derive the Sieve of Eratosthenes.

Naive solution:

```java
class Solution {
    public int countPrimes(int n) {
        var c = 0;
        var l = new ArrayList<Integer>();
        for (int i = 2; i < n; i++) {
            if (isPrime(i, l)) {
                c += 1;
                l.add(i);
            }
        }
        return c;
    }

    public boolean isPrime(int n, List<Integer> l) {
        var max = (int) Math.sqrt(n);

        for (var k : l) {
            if (k > max) {
                break;
            }
            if (n % k == 0) {
                return false;
            }
        }
        return true;
    }
}
```
