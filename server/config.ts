import dotenv from 'dotenv'
import { z } from 'zod'

dotenv.config()

const envSchema = z.object({
  PORT: z.coerce.number().default(8787),
  DEMO_USER_ID: z.string().default('demo-user'),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_STORAGE_BUCKET: z.string().default('journal-photos'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-5'),
})

const env = envSchema.parse(process.env)

export const config = {
  port: env.PORT,
  demoUserId: env.DEMO_USER_ID,
  storageBucket: env.SUPABASE_STORAGE_BUCKET,
  anthropicApiKey: env.ANTHROPIC_API_KEY,
  anthropicModel: env.ANTHROPIC_MODEL,
  supabaseUrl: env.SUPABASE_URL,
  supabaseAnonKey: env.SUPABASE_ANON_KEY,
  supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
}

export const hasSupabaseConfig = Boolean(
  config.supabaseUrl && config.supabaseAnonKey && config.supabaseServiceRoleKey,
)

export const hasAnthropicConfig = Boolean(config.anthropicApiKey)
