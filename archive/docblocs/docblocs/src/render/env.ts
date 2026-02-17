import { Dictionary, resolvePromises } from "../util";
import { template } from "./render";
import * as ast from "../ast";
import * as fs from "fs";

export const baseEnv = {
  let:
    (...args: any[]) =>
    (context: Dictionary<any>, bloc: Dictionary<any>) => {
      return bloc.contents.apply(null, args);
    },

  if: (test: boolean) => (context: Dictionary<any>, bloc: Dictionary<any>) => {
    if (test) {
      if (bloc.then) {
        return bloc.then;
      } else if (bloc.contents) {
        return bloc.contents;
      }
    } else {
      if (bloc.else) {
        return bloc.else;
      }
    }
  },

  eachof:
    (items: any[]) => (context: Dictionary<any>, bloc: Dictionary<any>) => {
      if (!Array.isArray(items)) {
        throw new TypeError("Argument to eachof is not an array");
      }
      return resolvePromises(
        items.map((item) => bloc.contents(item)(context, bloc)),
        true,
      );
    },

  require: (name: string) => {
    return new Promise<string>((resolve, reject) => {
      fs.readFile(name, (err, data) => {
        if (err) {
          reject(err.toString());
        } else {
          resolve(data.toString());
        }
      });
    }).then((text) => template(text, name));
  },
};
