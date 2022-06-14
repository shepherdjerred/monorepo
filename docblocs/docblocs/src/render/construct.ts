import { Eventually, eventuallyCall, Tree, flatten } from "../util";

export function constructResult(result: Eventually<Tree<string>>): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      let evBits = eventuallyCall(flatten, result);
      let evString = eventuallyCall(bits => bits.join(''), evBits);
      eventuallyCall(resolve, evString);
    }
    catch(e) {
      reject(e);
    }
  })
}