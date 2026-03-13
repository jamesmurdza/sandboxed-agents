-- AlterTable: add latest snapshot column to AgentExecution (replaces AgentEvent table)
ALTER TABLE "AgentExecution" ADD COLUMN IF NOT EXISTS "latestSnapshot" JSONB;

-- DropTable: streaming now uses single column on AgentExecution
DROP TABLE IF EXISTS "AgentEvent";
