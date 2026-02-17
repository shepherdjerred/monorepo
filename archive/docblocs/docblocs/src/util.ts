/*========================================================*/

export function merge<T, U>(t: T, u: U): T & U;
export function merge<T, U, V>(t: T, u: U, v: V): T & U & V;
export function merge<T, U, V, W>(t: T, u: U, v: V, w: W): T & U & V & W;
export function merge(): Dictionary<any> {
  let a: Dictionary<any> = {};
  for (let i = 0, l = arguments.length; i < l; ++i) {
    let b: Dictionary<any> = arguments[i];
    for (let key in b) {
      a[key] = b[key];
    }
  }
  return a;
}

/*========================================================*/

/**
 * Object used only to map keys to values.
 */
export interface Dictionary<T> {
  [key: string]: T;
}

/*========================================================*/

export interface ArrayTree<T> extends Array<T | ArrayTree<T>> {}

export type Tree<T> = T | ArrayTree<T>;

export function flatten<T>(tree: Tree<T>, result: T[] = []): T[] {
  if (Array.isArray(tree)) {
    for (let el of tree) {
      flatten(el, result);
    }
  } else {
    result.push(tree);
  }
  return result;
}

/*========================================================*/

/**
 * Indicates the variable may be undefined.
 */
export type Maybe<T> = T | undefined;

/**
 * Test a Maybe to see if it is defined.
 */
export function isDefined<T>(x: Maybe<T>): x is T {
  return x !== undefined && x !== null;
}

/**
 * Test a Maybe to see if it is undefined.
 */
export function isUndefined<T>(x: Maybe<T>): x is undefined {
  return x === undefined || x === null;
}

/*========================================================*/

/**
 * Array which keeps track of the top (last) element.
 */
export interface Stack<T> extends Array<T> {
  top?: T;
}

export var Stack = {
  /**
   */
  create<T>(...init: T[]): Stack<T> {
    return init;
  },

  /**
   * Add new element to top of stack.
   */
  push<T>(ts: Stack<T>, t: T) {
    ts.push(t);
    ts.top = t;
    return ts;
  },

  /**
   * Remove element from top of stack.
   * @returns the element removed
   */
  pop<T>(ts: Stack<T>): T {
    let t = ts.pop();
    if (!t) {
      throw new Error(
        "Precondition violation: pop() called on non-empty stack",
      );
    }
    let l = ts.length;
    if (l) {
      ts.top = ts[l - 1];
    } else {
      ts.top = undefined;
    }
    return t;
  },
};
/*========================================================*/

/**
 * Either a value or a promise for a value.
 */
export type Eventually<T> = T | PromiseLike<T>;

/**
 * Test an Eventually to see if it is a promise.
 */
export function isPromise(x: any): x is PromiseLike<any> {
  return typeof x === "object" && x !== null && typeof x.then === "function";
}

/**
 * Return a new Eventually which has the value of an old Eventually, or else
 * a default value if the old Eventually turns out to be undefined.
 */
export function eventuallyDefault<T, U>(
  v: Eventually<T>,
  w: U,
): Eventually<T | U> {
  if (isPromise(v)) {
    return v.then((x) => (x === undefined ? w : x));
  } else {
    return v === undefined ? w : v;
  }
}

/**
 * Call a function once all arguments are ready.
 */
export function eventuallyCall<T, U>(
  f: (u: U) => T,
  eu: Eventually<U>,
): Eventually<T>;
export function eventuallyCall<T, U, V>(
  f: (u: U, v: V) => T,
  eu: Eventually<U>,
  ev: Eventually<V>,
): Eventually<T>;
export function eventuallyCall<T, U, V, W>(
  f: (u: U, v: V, w: W) => T,
  eu: Eventually<U>,
  ev: Eventually<V>,
  ew: Eventually<W>,
): Eventually<T>;
export function eventuallyCall<T, U, V, W, X>(
  f: (u: U, v: V, w: W, x: X) => T,
  eu: Eventually<U>,
  ev: Eventually<V>,
  ew: Eventually<W>,
  ex: Eventually<X>,
): Eventually<T>;
export function eventuallyCall<T>(
  f: (...args: any[]) => T,
  ...args: any[]
): Eventually<T> {
  let p = resolvePromises(args);
  if (isPromise(p)) {
    return p.then((resolvedArgs: any[]) => {
      return f.apply(null, resolvedArgs);
    });
  } else {
    return f.apply(null, args);
  }
}

/**
 * Search a recursive object/array data structure looking for promises.
 * Return value which will eventually be the structure with all promises
 * replaced with their values.
 */
export function resolvePromises<T>(
  value: Eventually<T>[],
  catchReject?: boolean,
): Eventually<T[]> {
  let result: T[] = [];
  let promises: PromiseLike<void>[] = [];

  let assignTo = (key: number) => (val: T) => {
    result[key] = val;
  };

  for (let i = 0, l = value.length; i < l; ++i) {
    let t = value[i];
    if (isPromise(t)) {
      if (catchReject) {
        promises.push(t.then(assignTo(i), assignTo(i)));
      } else {
        promises.push(t.then(assignTo(i)));
      }
    } else {
      result[i] = t;
    }
  }

  if (promises.length) {
    return Promise.all(promises).then(() => result);
  } else {
    return result;
  }
}

/**
 *
export function resolvePromises(value: any): Eventually<any> {
  var promises: PromiseLike<any>[] = [];

  let resolve = (key: string|number) => (val: Object) => {
    return value[key] = val;
  };

  if (Array.isArray(value) ||
      typeof value === 'object' && value !== null &&
      Object.getPrototypeOf(value) === Object.prototype) {
    for (let key in value) {
      let v = resolvePromises(value[key]);
      if (isPromise(v)) {
        promises.push(v.then(resolve(key)))
      }
    }
  }

  if (promises.length) {
    return Promise.all(promises).then(() => value);
  }
  else {
    return value;
  }
}

/**
 */

export function curry(f: Function, args?: any[]): Function {
  if (!Array.isArray(args)) {
    args = [];
  }
  let cf = function () {
    let more = (args as any[]).concat(Array.prototype.slice.call(arguments));
    if (more.length >= f.length) {
      return f.apply(this, more);
    } else {
      return curry(f, more);
    }
  };
  Object.defineProperties(cf, {
    name: {
      configurable: true,
      value: args.length ? `${f.name}_${args.length}` : f.name,
    },
    length: { configurable: true, value: f.length - args.length },
  });
  return cf;
}
