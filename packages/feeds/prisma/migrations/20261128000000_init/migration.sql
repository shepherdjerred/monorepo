-- CreateEnum
CREATE TYPE "feed_source" AS ENUM ('code', 'user');

-- CreateTable
CREATE TABLE "meta" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "meta_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" SERIAL NOT NULL,
    "label" TEXT NOT NULL,
    "managed" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 100,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feeds" (
    "id" SERIAL NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category_id" INTEGER NOT NULL,
    "html_url" TEXT,
    "description" TEXT,
    "source" "feed_source" NOT NULL,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "auto_read_json" TEXT,
    "etag" TEXT,
    "last_modified" TEXT,
    "last_polled_at" BIGINT,
    "last_success_at" BIGINT,
    "last_status" INTEGER,
    "last_error" TEXT,
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "next_poll_after" BIGINT,

    CONSTRAINT "feeds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- search_document holds a tsvector literal the service builds with an
-- FTS5-unicode61-compatible tokenizer (src/server/search/search-tokens.ts); casting
-- the literal bypasses PostgreSQL's own text parser, so search matches the
-- same entries SQLite FTS5 did.
CREATE TABLE "entries" (
    "id" BIGINT NOT NULL,
    "feed_id" INTEGER NOT NULL,
    "guid" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT NOT NULL DEFAULT '',
    "content_html" TEXT NOT NULL DEFAULT '',
    "published_at" BIGINT NOT NULL,
    "crawled_at_ms" BIGINT NOT NULL,
    "enclosures_json" TEXT NOT NULL DEFAULT '[]',
    "categories_json" TEXT NOT NULL DEFAULT '[]',
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "is_starred" BOOLEAN NOT NULL DEFAULT false,
    "auto_read_matched" BOOLEAN NOT NULL DEFAULT false,
    "search_document" TEXT NOT NULL DEFAULT '',
    "search_vector" tsvector GENERATED ALWAYS AS ("search_document"::tsvector) STORED,

    CONSTRAINT "entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reader_sessions" (
    "token_sha256" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,
    "expires_at" BIGINT NOT NULL,

    CONSTRAINT "reader_sessions_pkey" PRIMARY KEY ("token_sha256")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_label_key" ON "categories"("label");

-- CreateIndex
CREATE UNIQUE INDEX "feeds_url_key" ON "feeds"("url");

-- CreateIndex
CREATE INDEX "feeds_category_id_idx" ON "feeds"("category_id");

-- CreateIndex
CREATE INDEX "entries_feed_id_id_idx" ON "entries"("feed_id", "id" DESC);

-- CreateIndex
CREATE INDEX "entries_is_read_id_idx" ON "entries"("is_read", "id" DESC);

-- CreateIndex
CREATE INDEX "entries_is_starred_id_idx" ON "entries"("is_starred", "id" DESC);

-- CreateIndex
CREATE INDEX "entries_published_at_idx" ON "entries"("published_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "entries_feed_id_guid_key" ON "entries"("feed_id", "guid");

-- CreateIndex
CREATE INDEX "entries_search_vector_idx" ON "entries" USING GIN ("search_vector");

-- AddForeignKey
ALTER TABLE "feeds" ADD CONSTRAINT "feeds_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entries" ADD CONSTRAINT "entries_feed_id_fkey" FOREIGN KEY ("feed_id") REFERENCES "feeds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed
INSERT INTO "meta" ("key", "value") VALUES ('subscriptions_etag', '1');
