# Interview Misc

## Copy an array

```java
Arrays.copyOf(T[], int)
```

Int is the length of the new array

## Random int between min and max

```java
var rand = new Random();
rand.nextInt((max - min) + 1) + min;
```

## Random int between 0 and 50

```java
var rand = new Random();
int n = rand.nextInt(50 + 1);
```

## Copy a range of an array

```java
var result = Arrays.copyOfRange(array, start, end); [start, end)
```

## Test if a number is prime (when to stop)

You only need to check divisors up to the sqrt of the number being tested

## Prime Number

A number that is greater than 1 and not cleanly divisble (e.g. leaves no remainder) by any numbers other than 1 and itself.

## Iterate over String

```java
var s = "";
for (var c : s.toCharArray()) {
   // do something with c
}
```

## Convert English ASCII to array index

```java
char my_char = 'a';
int i = (int) my_char - 'a';
print(i) // 0
```

## Priority Queue with custom int comparator

```java
new PriorityQueue<Integer>((l, r) -> Integer.compare(a[r], a[l]));
```

## Remove from priority queue

```java
pq.poll();
```

## Min priority queue

```java
new PriorityQueue<>();
```

## Max priority queue

```java
new PriorityQueue<>(Collections.reverseOrder());
```

## Get character from index

```java
string.charAt(index);
```

## Topological Sort

1. Create an indegree array that keeps track of how many incoming edges each vertex has
1. Create a stack (or queue), seed it with the vertexes that have an indegree of zero
1. While the stack is not empty, pop, decrement the indegree of any vertexes that the popped node had an edge to, if the indegree of the vertex is now zero then add to the stack

## When to use a adjacency matrix vs adjacency list

Matrix is better for dense graphs, list is better for sparse

## Sort an array

```java
Arrays.sort(arr)
```

## Check if two arrays are equal

```java
Arrays.equals()
```

## BFS vs DFS for shortest path

Use BFS. DFS does not always yield shortest paths.

## Dijkstra vs BFS

Dijkstra supports weighted graphs

## Create a new queue

```java
Queue<T> q = new LinkedList<T>();
```

## Improving BFS

Alternatives are best first search or A* search

## Lattice Graph

A graph that when drawn forms a regular tiling. e.g. an array when represented as a graph forms a square grid.

## null check for fast pointer linked list

Check only enough to ensure an NPE won't occur

## Increment/add a value to a hashmap

```java
map.merge(key, 1, Integer::sum);
```

## Sum an array

```java
Arrays.stream(array).reduce(Integer::sum).orElse(0);
```

## Sum a list

```java
list.stream().reduce(Integer::sum).orElse(0);
```

## Sort a list

```java
Collections.sort(list);
```

## Convert a Set to List

```java
var list = new ArrayList<>();
list.addAll(set);
```

## Zero-pad int to string

```java
String.format("%02d", 1) // -> 01
```

## Square brackets clusivity

Closed interval, inclusive

## Parentheses clusivity

Open interval, exclusive

## Substring

```java
"".substring(begin, end);
```

[begin, end) -- begin is included, end is excluded

## Decrement from HashMap, remove if zero

```java
m.compute(key, (k, v) -> k == 1 ? null : v - 1);
```

## Get next from HashMap

```java
m.entrySet().iterator().next();
```

## Array to list

```java
Arrays.asList(arr);
```

## Fill an array with some value

```java
Arrays.fill(array, value);
```

## Convert int List to Array

```java
list.stream().mapToInt(i -> i).toArray();
```

## Binary search array

```java
Arrays.binarySearch(arr, target);
```

## Binary search insertion point

```java
var pos = Arrays.binarySearch(arr, target)
// target wasn't found
// pos will contain insert position
if (pos < 0) {
  pos = (pos + 1) * -1;
}
return pos
```

## Binary search with start/end + clusivity

```java
Arrays.binarySearch(arr, from, to, target);
```

[from, to)

## Reverse sort array

```java
Arrays.sort(arr, Collections.reverseOrder());
```

## Binary search with custom comparator

```java
Arrays.binarySearch(arr, target, comparator);
```

## Properties of list of intervals sorted by start

All mergeable intervals must occur in a contiguous run of the sorted list.

## Java stream filter

true includes, false excludes

## Record syntax

```java
record Coord(int row, int col) {}
```

## Java stream to list

```java
.collect(Collectors.toList())
```

## Java stream to set

```java
.collect(Collectors.toSet())
```
