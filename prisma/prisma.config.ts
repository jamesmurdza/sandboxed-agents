import "dotenv/config"
import { defineConfig, env } from "prisma/config"

export default defineConfig({
  earlyAccess: true,
  schema: "prisma/schema.prisma",
  migrate: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL_UNPOOLED"),
  },
})
