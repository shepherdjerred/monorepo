# Category: The Essence of Composition
### 1. Implement, as best as you can, the identity function in your favorite language (or the second favorite, if you favorite language happens to be Haskell).
```java
class Scratch {
    <T> T identity(T object) {
        return object;
    }
}
```

### 2. Implement the composition function in your favorite language. It takes two functions as arguments and returns a function that is their composition.

```java
import java.util.function.Function;

class Scratch {
    static <A, B, C> Function<A, C> compose(Function<A, B> firstMorphism, Function<B, C> secondMorphism) {
        return (A object) -> secondMorphism.apply(firstMorphism.apply(object));
    }
}
```

### 3. Write a program that tries to test that your composition function respects identity.
```java
import java.util.function.Function;

class Scratch {
    public static void main(String[] args) {
        var inc = (Function<Integer, Integer>) (Integer i) -> i+= 1;
        var id = (Function<Integer, Integer>) (Integer i) -> i;
        System.out.println(compose(inc, id).apply(0));
        System.out.println(compose(id, id).apply(0));
        System.out.println(compose(inc, inc).apply(0));
    }
}
```

### 4. Is the world-wide web a category in any sense? Are links morphisms?

Yes. The web could be considered a category. For each valid URL there is one object. Morphisms exists between object that represent links from one page to another

### 5. Is Facebook a category, with people as objects and friendships as morphisms?

Facebook can definitely be represented as a undirected cyclic graph with each individual as a vertex and each friendship as an edge. The identity function could be approximated with each individual having an edge to themselves.

This probably doesn't fit into the definition of a category. consider A <-> B <-> C where A is friends with B, B is friends with A and C, and C is friends with C. If each vertex is a vertex and each edge is a friendship, then there would be a morphism from A -> B -> C even though A is not friends with C -- C is a friend of B who is a friend of A.

### 6. When is a directed graph a category?

When each vertex has an edge directed to itself which represents the identity morphism.
