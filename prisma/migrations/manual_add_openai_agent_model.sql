-- Add openaiApiKey to UserCredentials (nullable, so existing records are fine)
ALTER TABLE "UserCredentials" ADD COLUMN IF NOT EXISTS "openaiApiKey" TEXT;

-- Add agent and model to Branch (agent has default, model is nullable)
ALTER TABLE "Branch" ADD COLUMN IF NOT EXISTS "agent" TEXT DEFAULT 'claude';
ALTER TABLE "Branch" ADD COLUMN IF NOT EXISTS "model" TEXT;

-- Update existing branches to have the default agent if null
UPDATE "Branch" SET "agent" = 'claude' WHERE "agent" IS NULL;

-- Now make agent NOT NULL since all rows have a value
ALTER TABLE "Branch" ALTER COLUMN "agent" SET NOT NULL;
