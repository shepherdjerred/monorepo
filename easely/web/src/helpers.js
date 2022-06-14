function numberOfKeys (obj) {
  return Object.keys(obj).length;
}

// https://stackoverflow.com/questions/6857468/converting-a-js-object-to-an-array
function objectToArray (obj) {
  return Object.keys(obj).map(key => obj[key]);
}

function sortAssignmentArrayByDate (assignments) {
  let sortedAssignments = assignments;
  sortedAssignments.sort(function (a, b) {
    return a.date - b.date;
  });
  return sortedAssignments;
}

export default {
  numberOfKeys,
  objectToArray,
  sortAssignmentArrayByDate
};
