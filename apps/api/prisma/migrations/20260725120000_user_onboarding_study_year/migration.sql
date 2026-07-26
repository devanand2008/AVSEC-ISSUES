ALTER TABLE "users"
ADD COLUMN "onboarding_study_year" INTEGER;

ALTER TABLE "users"
ADD CONSTRAINT "users_onboarding_study_year_check"
CHECK ("onboarding_study_year" IS NULL OR "onboarding_study_year" BETWEEN 1 AND 8);
