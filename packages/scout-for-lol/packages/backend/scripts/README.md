# Prisma Type Branding Script

This directory contains a post-processor that transforms Prisma's generated types to use branded IDs from `@scout-for-lol/data`.

## What It Does

After `prisma generate` creates type definitions, this script:

1. **Parses the generated TypeScript AST** using `ts-morph`
2. **Finds all `$XPayload` types** in the Prisma namespace
3. **Transforms number IDs to branded types**:
   - `Player.id: number` → `Player.id: PlayerId`
   - `Account.id: number` → `Account.id: AccountId`
   - `Account.playerId: number` → `Account.playerId: PlayerId`
   - `Competition.id: number` → `Competition.id: CompetitionId`
   - `CompetitionParticipant.*Id: number` → Branded equivalents
   - And more...
4. **Adds imports** for branded types from `@scout-for-lol/data`
5. **Saves the modified types** back to the generated file

## Usage

The script runs automatically after `prisma generate`:

```bash
# Regenerate Prisma client with branded types
bun run db:generate

# Or run the branding manually
bun run brand-types
```

## Configuration

Edit `scripts/brand-prisma-types.ts` to customize which fields get branded:

```typescript
const BRAND_MAPPINGS = {
  id: {
    Player: "PlayerId",
    Account: "AccountId",
    Competition: "CompetitionId",
    // Add more model-specific mappings
  },
  playerId: "PlayerId",
  competitionId: "CompetitionId",
  // Add more field mappings
};
```

## Result

After running, Prisma's generated types automatically use branded IDs:

```typescript
// Before transformation:
export type $PlayerPayload = {
  scalars: {
    id: number; // ← Plain number
    alias: string;
    // ...
  };
};

// After transformation:
import { PlayerId } from "@scout-for-lol/data";

export type $PlayerPayload = {
  scalars: {
    id: PlayerId; // ← Branded type!
    alias: string;
    // ...
  };
};
```

## Benefits

✅ **No wrapper client needed** - Use Prisma directly
✅ **Automatic branding** - All queries return branded types
✅ **Zero runtime cost** - Pure type-level transformation
✅ **Type safety** - Can't mix PlayerID with CompetitionId
✅ **Transparent** - Works with all Prisma features

## How It Works

Uses TypeScript's AST (via ts-morph) to:

1. Navigate to `Prisma` namespace
2. Find type aliases like `$PlayerPayload<ExtArgs>`
3. Locate the `scalars:` property
4. Transform field types inside `$Extensions.GetPayloadResult<{ ... }, ...>`
5. Replace `number` with branded types where configured

This is **much more robust** than regex-based replacement because it:

- Understands TypeScript syntax
- Preserves formatting
- Only transforms the exact fields we want
- Handles complex generic types correctly

## Implementation

**File**: `scripts/brand-prisma-types.ts`
**Dependencies**: `ts-morph` (TypeScript Compiler API wrapper)
**Runtime**: Bun (works with Node.js too)

## Maintenance

The script is designed to be resilient to Prisma updates. If Prisma changes their generated type structure significantly, you may need to update the AST traversal logic in `transformPayloadType()`.

Current implementation tested with:

- Prisma 6.18.0
- TypeScript 5.x
- Bun 1.3.1
