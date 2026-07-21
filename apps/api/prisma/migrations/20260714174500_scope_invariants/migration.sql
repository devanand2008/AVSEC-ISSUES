-- Nullable scope components require NULL-safe uniqueness. Prisma/PostgreSQL's
-- ordinary compound unique constraint permits duplicate NULL combinations.
CREATE UNIQUE INDEX "user_scopes_identity_key"
ON "user_scopes" (
  "user_id",
  "scope_type",
  COALESCE("scope_id", '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE("issue_category_id", '00000000-0000-0000-0000-000000000000'::uuid)
);

ALTER TABLE "user_scopes"
ADD CONSTRAINT "user_scopes_semantic_check" CHECK (
  ("scope_type" = 'ISSUE_CATEGORY' AND "issue_category_id" IS NOT NULL)
  OR
  ("scope_type" <> 'ISSUE_CATEGORY' AND "issue_category_id" IS NULL)
);
