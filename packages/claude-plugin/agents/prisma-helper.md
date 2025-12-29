---
description: Prisma ORM for type-safe database access - schema design, migrations, queries, relations, and connection management
when_to_use: When user works with Prisma, database schemas, migrations, Prisma Client queries, or mentions prisma commands
---

# Prisma Helper Agent

## What's New in Prisma 7+ (2025)

- **New `prisma-client` generator**: Replaces deprecated `prisma-client-js` with better ESM/Bun/Deno support
- **All-TypeScript engine**: Faster, lighter ORM without Rust binary engines
- **TypedSQL**: Write `.sql` files with full type safety (v5.19.0+)
- **`createManyAndReturn()`** and **`updateManyAndReturn()`**: Bulk operations returning results
- **`omit`**: Exclude fields from queries (opposite of `select`)
- **Relation load strategies**: Choose between `join` or `query` loading

## Core Concepts

Prisma consists of three main components:
1. **Prisma Schema**: Data model definition (models, relations, attributes)
2. **Prisma Migrate**: Database migration workflow
3. **Prisma Client**: Type-safe query builder

## CLI Commands

| Command | Purpose |
|---------|---------|
| `prisma init` | Initialize Prisma in project |
| `prisma generate` | Generate Prisma Client from schema |
| `prisma migrate dev --name <name>` | Create and apply migration (development) |
| `prisma migrate deploy` | Apply pending migrations (production) |
| `prisma db push` | Push schema to database without migration |
| `prisma db pull` | Introspect database and update schema |
| `prisma studio` | Open visual database editor |
| `prisma format` | Format schema file |

## Schema Definition

### Generator Configuration

**Prisma 5.x/6.x (current stable):**
```prisma
generator client {
  provider = "prisma-client-js"
}
```

**Prisma 7+ (new format with runtime options):**
```prisma
generator client {
  provider = "prisma-client"   // replaces "prisma-client-js"
  output   = "./generated/client"
  runtime  = "bun"             // nodejs, deno, bun, workerd
  moduleFormat = "esm"         // esm or cjs
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

### Model Definition

```prisma
model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  name      String?
  posts     Post[]
  profile   Profile?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([email])
  @@map("users")
}

model Post {
  id        Int      @id @default(autoincrement())
  title     String
  content   String?
  published Boolean  @default(false)
  authorId  Int
  author    User     @relation(fields: [authorId], references: [id], onDelete: Cascade)

  @@index([authorId])
}
```

### Field Attributes

| Attribute | Purpose | Example |
|-----------|---------|---------|
| `@id` | Primary key | `id Int @id` |
| `@@id` | Composite primary key | `@@id([a, b])` |
| `@unique` | Unique constraint | `email String @unique` |
| `@@unique` | Compound unique | `@@unique([firstName, lastName])` |
| `@default` | Default value | `@default(now())`, `@default(uuid())` |
| `@updatedAt` | Auto-update timestamp | `updatedAt DateTime @updatedAt` |
| `@relation` | Define relationship | See relations section |
| `@map` | Map to database column | `@map("user_name")` |
| `@@map` | Map to database table | `@@map("users")` |
| `@@index` | Database index | `@@index([title, content])` |
| `@ignore` | Exclude from Prisma Client | `legacyField String @ignore` |

### Default Value Functions

| Function | Purpose |
|----------|---------|
| `autoincrement()` | Auto-incrementing integer |
| `uuid()` / `uuid(7)` | UUID generation |
| `cuid()` / `cuid(2)` | CUID generation |
| `ulid()` | ULID generation |
| `nanoid(length)` | Nano ID generation |
| `now()` | Current timestamp |
| `dbgenerated(expr)` | Database-level default |

## Relations

### One-to-One

```prisma
model User {
  id      Int      @id @default(autoincrement())
  profile Profile?
}

model Profile {
  id     Int  @id @default(autoincrement())
  userId Int  @unique
  user   User @relation(fields: [userId], references: [id])
}
```

### One-to-Many

```prisma
model User {
  id    Int    @id @default(autoincrement())
  posts Post[]
}

model Post {
  id       Int  @id @default(autoincrement())
  authorId Int
  author   User @relation(fields: [authorId], references: [id])
}
```

### Many-to-Many (Implicit)

```prisma
model Post {
  id         Int        @id @default(autoincrement())
  categories Category[]
}

model Category {
  id    Int    @id @default(autoincrement())
  posts Post[]
}
```

### Referential Actions

```prisma
@relation(fields: [authorId], references: [id], onDelete: Cascade, onUpdate: Cascade)
```

Options: `Cascade`, `Restrict`, `NoAction`, `SetNull`, `SetDefault`

## Prisma Client Queries

### CRUD Operations

```typescript
// Create
const user = await prisma.user.create({
  data: { email: 'user@example.com', name: 'User' }
})

// Create with relation
const userWithPosts = await prisma.user.create({
  data: {
    email: 'user@example.com',
    posts: {
      create: [{ title: 'Post 1' }, { title: 'Post 2' }]
    }
  },
  include: { posts: true }
})

// Read
const user = await prisma.user.findUnique({ where: { id: 1 } })
const user = await prisma.user.findUniqueOrThrow({ where: { id: 1 } })
const users = await prisma.user.findMany({ where: { published: true } })
const first = await prisma.user.findFirst({ where: { name: { contains: 'John' } } })

// Update
const user = await prisma.user.update({
  where: { id: 1 },
  data: { name: 'Updated Name' }
})

// Upsert
const user = await prisma.user.upsert({
  where: { email: 'user@example.com' },
  update: { name: 'Updated' },
  create: { email: 'user@example.com', name: 'New' }
})

// Delete
await prisma.user.delete({ where: { id: 1 } })

// Bulk operations
await prisma.user.createMany({ data: [...], skipDuplicates: true })
await prisma.user.updateMany({ where: {...}, data: {...} })
await prisma.user.deleteMany({ where: {...} })
```

### Filtering

```typescript
// Comparison operators
where: { age: { gt: 18, lte: 65 } }
where: { name: { contains: 'john', mode: 'insensitive' } }
where: { email: { startsWith: 'admin', endsWith: '.com' } }
where: { id: { in: [1, 2, 3] } }
where: { id: { notIn: [4, 5, 6] } }

// Logical operators
where: { OR: [{ email: { contains: 'a' } }, { name: { contains: 'b' } }] }
where: { AND: [{ published: true }, { authorId: 1 }] }
where: { NOT: { email: { contains: 'test' } } }

// Relation filters
where: { posts: { some: { published: true } } }
where: { posts: { every: { published: true } } }
where: { posts: { none: { published: true } } }

// Null filtering
where: { profile: null }
where: { profile: { isNot: null } }
```

### Select and Include

```typescript
// Select specific fields
const user = await prisma.user.findUnique({
  where: { id: 1 },
  select: { id: true, email: true, posts: { select: { title: true } } }
})

// Include relations
const user = await prisma.user.findUnique({
  where: { id: 1 },
  include: { posts: true, profile: true }
})

// Omit fields (exclude sensitive data)
const user = await prisma.user.findUnique({
  where: { id: 1 },
  omit: { password: true }
})
```

### Pagination and Sorting

```typescript
// Pagination
const users = await prisma.user.findMany({
  skip: 10,
  take: 20,
  orderBy: { createdAt: 'desc' }
})

// Cursor-based pagination
const users = await prisma.user.findMany({
  take: 10,
  cursor: { id: lastUserId },
  orderBy: { id: 'asc' }
})

// Multiple sort fields
orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }]

// Sort by relation count
orderBy: { posts: { _count: 'desc' } }

// Null handling
orderBy: { name: { sort: 'asc', nulls: 'last' } }
```

### Aggregation

```typescript
// Aggregate
const result = await prisma.user.aggregate({
  _count: { _all: true },
  _avg: { age: true },
  _sum: { age: true },
  _min: { age: true },
  _max: { age: true }
})

// Group by
const grouped = await prisma.user.groupBy({
  by: ['country'],
  _count: { id: true },
  _avg: { age: true },
  having: { age: { _avg: { gt: 25 } } }
})

// Count relations
const user = await prisma.user.findUnique({
  where: { id: 1 },
  include: { _count: { select: { posts: true } } }
})
```

## Transactions

### Sequential Operations

```typescript
const [user, post] = await prisma.$transaction([
  prisma.user.create({ data: { email: 'user@example.com' } }),
  prisma.post.create({ data: { title: 'Post', authorId: 1 } })
])
```

### Interactive Transactions

```typescript
const result = await prisma.$transaction(async (tx) => {
  const user = await tx.user.findUnique({ where: { id: 1 } })
  if (!user) throw new Error('User not found')

  return tx.user.update({
    where: { id: 1 },
    data: { balance: { decrement: 100 } }
  })
}, {
  maxWait: 5000,
  timeout: 10000,
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable
})
```

### Atomic Operations

```typescript
// Increment/decrement
await prisma.user.update({
  where: { id: 1 },
  data: { balance: { increment: 100 } }
})

// Multiply/divide
await prisma.product.update({
  where: { id: 1 },
  data: { price: { multiply: 1.1 } }
})
```

## Raw SQL

### TypedSQL (Recommended for v5.19.0+)

Create a `.sql` file in `prisma/sql/`:

```sql
-- prisma/sql/findUsers.sql
SELECT id, email, name FROM users WHERE email LIKE $1
```

Run `prisma generate --sql` then use:

```typescript
import { findUsers } from '@prisma/client/sql'
const users = await prisma.$queryRawTyped(findUsers('%@example.com'))
```

### Raw Queries

```typescript
// Parameterized query (safe)
const users = await prisma.$queryRaw`
  SELECT * FROM users WHERE email = ${email}
`

// Execute without return
await prisma.$executeRaw`
  UPDATE users SET name = ${name} WHERE id = ${id}
`
```

## Connection Management

### Best Practices

**❌ Avoid: Creating new clients per request**
```typescript
app.get('/users', async (req, res) => {
  const prisma = new PrismaClient()  // Bad!
  const users = await prisma.user.findMany()
  await prisma.$disconnect()
  res.json(users)
})
```

**✅ Prefer: Single shared instance**
```typescript
// lib/prisma.ts
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }
export const prisma = globalForPrisma.prisma || new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

### Explicit Connection/Disconnection

```typescript
// For scripts and one-off operations
const prisma = new PrismaClient()

try {
  await prisma.$connect()
  // ... operations
} finally {
  await prisma.$disconnect()
}
```

## Error Handling

```typescript
import { Prisma } from '@prisma/client'

try {
  await prisma.user.create({ data: { email: 'existing@email.com' } })
} catch (e) {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === 'P2002') {
      console.log('Unique constraint violation on:', e.meta?.target)
    }
  }
  throw e
}
```

Common error codes:
- `P2002`: Unique constraint violation
- `P2003`: Foreign key constraint violation
- `P2025`: Record not found

## Testing

### Unit Testing (Mocking)

```typescript
import { mockDeep, DeepMockProxy } from 'jest-mock-extended'
import { PrismaClient } from '@prisma/client'

const prismaMock = mockDeep<PrismaClient>()

prismaMock.user.findUnique.mockResolvedValue({
  id: 1,
  email: 'test@example.com',
  name: 'Test User'
})
```

### Integration Testing

```typescript
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

beforeAll(async () => {
  await prisma.$connect()
})

afterAll(async () => {
  await prisma.$disconnect()
})

afterEach(async () => {
  // Clean up in correct order (respect foreign keys)
  await prisma.$transaction([
    prisma.post.deleteMany(),
    prisma.user.deleteMany()
  ])
})
```

## Logging

```typescript
const prisma = new PrismaClient({
  log: [
    { level: 'query', emit: 'event' },
    { level: 'error', emit: 'stdout' },
    { level: 'warn', emit: 'stdout' }
  ]
})

prisma.$on('query', (e) => {
  console.log('Query:', e.query)
  console.log('Duration:', e.duration, 'ms')
})
```

## Database Indexes

```prisma
model Post {
  id      Int    @id
  title   String
  content String

  // Standard index
  @@index([title])

  // Composite index
  @@index([title, content])

  // PostgreSQL GIN index for full-text search
  @@index([content], type: Gin)

  // Full-text index (MySQL, MongoDB)
  @@fulltext([title, content])
}
```

## Best Practices Summary

1. Use a **single PrismaClient instance** across your application
2. Always use **parameterized queries** to prevent SQL injection
3. Use **`select`** to fetch only needed fields for performance
4. Use **`include`** sparingly; prefer **`select`** with nested relations
5. Use **transactions** for related operations that must succeed together
6. Always **disconnect** in scripts and tests
7. Use **migrations** for production; **db push** only in development
8. Handle **PrismaClientKnownRequestError** for user-friendly errors
9. Use **indexes** on frequently queried and filtered columns
10. Keep **environment variables** for database URLs

## When to Ask for Help

- Complex multi-tenant setups with row-level security
- Database-specific features not expressible in Prisma schema
- Performance optimization for very large datasets
- Unusual migration scenarios (data transformations, custom SQL)
- Prisma with non-standard database configurations
