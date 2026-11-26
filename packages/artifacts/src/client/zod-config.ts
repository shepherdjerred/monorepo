import { z } from "zod";

// Zod's JIT probes `new Function`, which a strict app policy reports. This
// module is imported first so it runs before any schema is built.
z.config({ jitless: true });
