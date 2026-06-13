// https://stackoverflow.com/questions/2532218/pick-random-property-from-a-javascript-object
function pickRandomProperty(obj) {
  let keys = Object.keys(obj);
  return obj[keys[(keys.length * Math.random()) << 0]];
}

function numberOfKeys(obj) {
  return Object.keys(obj).length;
}

// https://stackoverflow.com/questions/6857468/converting-a-js-object-to-an-array
function objectToArray(obj) {
  return Object.keys(obj).map((key) => obj[key]);
}

export default {
  pickRandomProperty,
  numberOfKeys,
  objectToArray,
};
