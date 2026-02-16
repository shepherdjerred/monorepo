import { recommended, astroConfig } from "@shepherdjerred/eslint-config";

export default [...recommended({ tsconfigRootDir: import.meta.dirname }), ...astroConfig()];
