module.exports = {
  presets: ["module:@react-native/babel-preset"],
  plugins: [
    // zod v4 ships `export * as ns from ...`, which the RN preset does not
    // transform on its own — without this, Metro 500s bundling node_modules/zod.
    "@babel/plugin-transform-export-namespace-from",
    "react-native-worklets/plugin",
  ],
};
