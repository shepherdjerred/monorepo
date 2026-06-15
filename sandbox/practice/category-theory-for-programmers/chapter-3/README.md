# Categories Great and Small

### 1. Generate a free category from:

#### 1a. A graph with one node and no edges

![Graphviz output. Source code is listed in below in plaintext.](1a.svg)

```graphviz
digraph Category {
    a -> a[label="id"]
}
```

#### 1b. A graph with one node and one (directed) edge (hint: this edge can be composed with itself)

Edges from a node to itself are infinitely composable. I've left those arrows out for the sake of brevity.

![Graphviz output. Source code is listed in below in plaintext.](1b.svg)

```graphviz
digraph Category {
    a -> a[label="id"]
    a -> a[label="f"]
}
```

#### 1c. A graph with two nodes and a single arrow between them

![Graphviz output. Source code is listed in below in plaintext.](1c.svg)

```graphviz
digraph Category {
    a -> a[label="id"]
    a -> b[label="f"]
    b -> b[label="id"]
}
```

#### 1d. A graph with a single node and 26 arrows marked with the letters of the alphabet: a, b, c … z.

Edges from a node to itself are infinitely composable. I've left those arrows out for the sake of brevity.

![Graphviz output. Source code is listed in below in plaintext.](1d.svg)

```graphviz
digraph Category {
    a -> a[label="id"]
    a -> a[label="a"]
    a -> a[label="b"]
    a -> a[label="c"]
    a -> a[label="..."]
}
```

### 2. What kind of order is this?

#### 2a. A set of sets with the inclusion relation: A is included in B if every element of A is also an element of B.

A must be a subset of B to satisfy the inclusion relation. There cannot be an element in A that is not also in B. B may have elements that are not in A; B has at least the elements that are in A, therefore B must be a superset of A.

There may be elements in B that are not comparable to elements in A, therefore this cannot be a total order. This relation satisfies the definition of antisymmetry because (a <= b == b <= a == (a == b)), therefore it is a partial order.

#### 2b. C++ types with the following subtyping relation: T1 is a subtype of T2 if a pointer to T1 can be passed to a function that expects a pointer to T2 without triggering a compilation error.

This is a partial order. T2 is a superset or T1 while T1 is a subset T2.

### 3. Considering that Bool is a set of two values True and False, show that it forms two (set-theoretical) monoids with respect to, respectively, operator && (AND) and || (OR).

A monoid is a set with a binary operation. The set would be the values [True, False] with the operations AND and OR. The operation must be associative and there must be an element that acts as a unit.

AND is associative:

- TRUE && (TRUE && TRUE) = (TRUE && TRUE) && TRUE = TRUE
- FALSE && (TRUE && TRUE) = (FALSE && TRUE) && FALSE = FALSE

OR is associative:

- TRUE || (TRUE || TRUE) = (TRUE || TRUE) || TRUE = TRUE
- FALSE || (TRUE || TRUE) = (FALSE || TRUE) || FALSE = FALSE

The unit for AND is True. The unit for OR is False.

### 4. Represent the Bool monoid with the AND operator as a category: List the morphisms and their rules of composition.

![Graphviz output. Source code is listed in below in plaintext.](4.svg)

```graphviz
digraph Category {
    Bool
    Bool:n -> Bool:n[label="AND True (id)"]
    Bool:s -> Bool:s[label="AND False"]
}
```

Composition:

- x && True . x && True == x && True
- x && True . x && False == x && False
- x && False . x && False == x && False
- x && False . x && True == x && False

### 5. Represent addition modulo 3 as a monoid category.

(+ 0) % 3 is the closest thing to an identity morphism for the object in this category. It meets all of the criteria, but it's a little strange. For the value 3 within Number the identity function will return 0. I think that this is technically acceptable based on the mathematical/categorical definition of identity, but it isn't very intuitive to me.

![Graphviz output. Source code is listed in below in plaintext.](5.svg)

```graphviz
digraph Category {
    Number
    Number:n -> Number:n[label="(+ 0) % 3"]
    Number:s -> Number:s[label="(+ 1) % 3"]
    Number:e -> Number:e[label="(+ 2) % 3"]
    Number:w -> Number:w[label="(+ n) % 3"]

}
```
