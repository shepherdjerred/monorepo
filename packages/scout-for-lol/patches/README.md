# Patches Directory

This directory contains patches for dependencies managed via Bun's native patching system.

## Current Patches

### `satori@0.18.3.patch`

**Purpose**: Adds enhanced error messages to satori's JSX validation error

**What it does**: When satori encounters a `<div>` element with multiple children but no explicit `display` property, the error message now includes Props and Display context information to help with debugging.

**Error message example**:

```text
Expected <div> to have explicit "display: flex", "display: contents", or "display: none" if it has more than one child node.
Props: {"style":{"display":"block"},...}. Display: block
```

## How Patches Work

Patches are automatically applied by Bun when you run `bun install`. The patch definition is stored in:

- `package.json` → `patchedDependencies` field
- `bun.lock` → patch metadata

## Updating a Patch

If you need to update the satori patch (e.g., after upgrading satori):

### Step 1: Prepare the package

```bash
bun patch satori@0.18.3
```

This creates an editable copy of satori in `node_modules/satori/`.

### Step 2: Make your changes

Edit the package files directly in `node_modules/satori/`. For example, to update the satori error message:

```javascript
// node_modules/satori/dist/index.js
// Find the error about <div> needing display property and modify it
```

### Step 3: Test your changes

Run the tests to verify your changes work:

```bash
cd packages/report
bun test src/html/arena/realdata.integration.test.ts
```

### Step 4: Commit the patch

Once satisfied with your changes, commit them:

```bash
bun patch --commit node_modules/satori
```

Or if you have a different version:

```bash
bun patch --commit satori@<version>
```

Bun will:

- Generate an updated `.patch` file
- Update `package.json` with the new patch reference
- Update `bun.lock` with metadata

### Step 5: Test clean installation

To verify the patch is correctly applied on a fresh install:

```bash
# Remove node_modules
bun run clean

# Reinstall - patch should be applied automatically
bun install

# Verify it works
cd packages/report
bun test src/html/arena/realdata.integration.test.ts
```

## Removing a Patch

If a patch is no longer needed (e.g., the issue was fixed upstream):

1. Remove the package name from `package.json` → `patchedDependencies`
2. Delete the `.patch` file
3. Run `bun install` to reinstall the unpatched version

## Resources

- [Bun patch documentation](https://bun.sh/docs/pm/cli/patch)
- Patch file format: Unified diff (standard `git diff` format)
