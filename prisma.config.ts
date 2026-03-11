import "dotenv/config"
import { defineConfig } from "prisma/config"

// Add connect_timeout to handle Neon serverless cold starts
function addConnectionTimeout(url: string): string {
  if (!url) return url
  const separator = url.includes("?") ? "&" : "?"
  return `${url}${separator}connect_timeout=30`
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: addConnectionTimeout(
      process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || ""
    ),
  },
})
