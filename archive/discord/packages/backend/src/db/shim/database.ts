// deno-lint-ignore-file

import { Database as _Database } from "https://deno.land/x/sqlite3@0.10.0/mod.ts";
import { Statement } from "./statement.ts";

import type {
  DatabaseOpenOptions,
  RestBindParameters,
} from "https://deno.land/x/sqlite3@0.10.0/mod.ts";

type Callback = (err: Error | null, result?: any) => void;

export class Database extends _Database {
  // Constructor interface of the sqlite3 npm package
  constructor(filename: string, callback?: Callback);
  constructor(filename: string, mode?: number, callback?: Callback);

  // deno-lint-ignore constructor-super
  constructor(
    path: string | URL,
    mode?: number | Callback,
    callback?: Callback,
  ) {
    const options: DatabaseOpenOptions = {};

    if (typeof mode === "number") {
      options.flags = mode;
    }

    if (typeof mode === "function") {
      callback = mode;
    }

    try {
      super(path, options);
    } catch (error) {
      if (callback) {
        callback(error);
        return;
      }
      throw error;
    }

    // We need to wait for the database to be ready before we call the callback
    setTimeout(() => {
      callback?.(null);
    });
  }

  private getCallback(statement: Statement | null, arr: any[]) {
    let callback = (error: Error | null, result?: any) => {};

    if (arr.length > 0 && typeof arr[arr.length - 1] === "function") {
      callback = arr.pop();
    }

    if (arr.length === 1 && arr[0] === undefined) {
      arr = [];
    }

    if (statement) callback = callback.bind(statement);

    return { arr, callback };
  }

  close(callback?: (err: Error | null) => void): void {
    super.close();
    callback?.(null);
  }

  run(sql: string, ...params: RestBindParameters): number;
  run(sql: string, ...params: RestBindParameters): Database;
  run(sql: string, ...params: RestBindParameters): Database | number {
    const statement = new Statement(this, sql);
    let { callback } = this.getCallback(statement, params);
    let result = 0;

    try {
      result = statement.run(...params); // TODO handle result
    } catch (error) {
      console.error(error);
      callback(error);
    }

    callback(null, result);
    return this;
  }

  get<T>(
    sql: string,
    callback?: (this: Statement, err: Error | null, row: T) => void,
  ): this;
  get<T>(
    sql: string,
    params: any,
    callback?: (this: Statement, err: Error | null, row: T) => void,
  ): this;
  get(sql: string, ...params: any[]): this {
    const statement = new Statement(this, sql);
    let { callback } = this.getCallback(statement, params);
    let result: Record<string, any> | undefined;

    try {
      result = statement.get(...params);
      statement.finalize();
    } catch (error) {
      console.error(error);
      callback(error);
    }

    callback(null, result);
    return this;
  }

  all<T>(
    sql: string,
    callback?: (this: Statement, err: Error | null, rows: T[]) => void,
  ): this;
  all<T>(
    sql: string,
    params: any,
    callback?: (this: Statement, err: Error | null, rows: T[]) => void,
  ): this;
  all(sql: string, ...params: any[]): this {
    const statement = new Statement(this, sql);
    let { callback } = this.getCallback(statement, params);
    let result: Record<string, any>[] = [];

    try {
      result = statement.all(...params);
      statement.finalize();
    } catch (error) {
      console.error(error);
      callback(error);
    }

    callback(null, result);
    return this;
  }

  each<T>(
    sql: string,
    callback?: (this: Statement, err: Error | null, row: T) => void,
    complete?: (err: Error | null, count: number) => void,
  ): this;
  each<T>(
    sql: string,
    params: any,
    callback?: (this: Statement, err: Error | null, row: T) => void,
    complete?: (err: Error | null, count: number) => void,
  ): this;
  each(sql: string, ...params: any[]): this {
    const statement = new Statement(this, sql);
    let { callback } = this.getCallback(statement, params);

    for (const row of statement) {
      try {
        const result = row.run(...params);
        callback(null, result);
      } catch (error) {
        console.error(error);
        callback(error);
      }
    }

    statement.finalize();

    return this;
  }

  exec(sql: string, ...params: RestBindParameters): number;
  exec(sql: string, callback?: any): Database;
  exec(sql: string, ...params: RestBindParameters): Database | number {
    const statement = new Statement(this, sql);
    let { callback } = this.getCallback(statement, params);
    let result = 0;

    try {
      result = statement.run();
    } catch (error) {
      console.error(error);
      callback(error);
    }

    callback(null, result);
    return this;
  }

  prepare(
    sql: string,
    callback?: (this: Statement, err: Error | null) => void,
  ): Statement;
  prepare(
    sql: string,
    params: any,
    callback?: (this: Statement, err: Error | null) => void,
  ): Statement;
  prepare(sql: string, ...params: any[]): Statement {
    let statement: Statement | null = null;
    let error: Error | null = null;

    try {
      statement = new Statement(this, sql);
      params.length ? statement.bind(params) : statement;
    } catch (err) {
      error = err;
    }

    let { callback } = this.getCallback(statement, params);

    if (error) {
      callback(error);
      return statement as Statement;
    }

    callback(null);
    return statement as Statement;
  }

  serialize(callback?: () => void): void {
    callback?.();
  }

  parallelize(callback?: () => void): void {
    callback?.();
  }

  configure(option: "busyTimeout", value: number): void;
  configure(option: "limit", id: number, value: number): void;
  configure(option: "limit" | "busyTimeout", id: number, value?: number): void {
    // TODO implement
  }

  loadExtension(file: string, entryPoint?: string): void;
  loadExtension(filename: string, callback?: string | Callback): void {
    const entryPoint = typeof callback === "string" ? callback : undefined;
    super.loadExtension(filename, entryPoint);
    if (typeof callback === "function") {
      callback(null);
    }
  }

  wait(callback?: (param: null) => void): this {
    callback?.(null);
    return this;
  }

  interrupt(): void {
    // TODO implement
  }
}
