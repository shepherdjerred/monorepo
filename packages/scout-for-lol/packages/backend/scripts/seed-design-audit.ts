import { seedDesignAuditDatabase } from "../src/database/design-audit-seed.ts";

await seedDesignAuditDatabase(process.cwd());
