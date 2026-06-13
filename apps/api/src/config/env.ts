import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

loadEnv();
loadEnv({ path: '../../.env' });

const nodeEnv = z.enum(['development', 'test', 'production']).default('development');
const secretSchema = z.string().min(32, 'Secret must have at least 32 characters');

const envSchema = z.object({
  NODE_ENV: nodeEnv,
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  JWT_SECRET: secretSchema,
  JWT_PREVIOUS_SECRETS: z.string().default(''),
  JWT_ACCESS_TOKEN_TTL: z.string().regex(/^\d+[smhd]$/, 'JWT_ACCESS_TOKEN_TTL must be like 15m, 1h, or 7d').default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  COOKIE_SECRET: secretSchema.optional(),
  COOKIE_SECURE: z.coerce.boolean().optional(),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4040),
  CORS_ORIGINS: z.string().optional(),
  CORS_ORIGIN: z.string().optional(),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
  SENSITIVE_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(60),
  SIGNAL_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(120),
  APPROVAL_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(60),
  ADMIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(60),
  RULE_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(60),
  LOG_LEVEL: z.string().default('info'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
  ACTION_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
  ACTION_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  ACTION_LOCK_TTL_SECONDS: z.coerce.number().int().min(10).max(3600).default(120),
  OUTBOX_DISPATCH_INTERVAL_MS: z.coerce.number().int().min(250).max(60000).default(1000),
  OUTBOX_DISPATCH_BATCH_SIZE: z.coerce.number().int().min(1).max(200).default(25)
}).transform((value) => ({
  ...value,
  CORS_ORIGINS: value.CORS_ORIGINS ?? value.CORS_ORIGIN ?? 'http://localhost:3000',
  COOKIE_SECRET: value.COOKIE_SECRET ?? value.JWT_SECRET,
  COOKIE_SECURE: value.COOKIE_SECURE ?? value.NODE_ENV === 'production'
})).superRefine((value, ctx) => {
  const defaultSecrets = ['replace-me', 'development', 'changeme', 'secret'];
  const allSecrets = [value.JWT_SECRET, ...value.JWT_PREVIOUS_SECRETS.split(',').map((item) => item.trim()).filter(Boolean)];

  if (new Set(allSecrets).size !== allSecrets.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['JWT_PREVIOUS_SECRETS'], message: 'JWT secrets must be unique during rotation.' });
  }

  if (value.NODE_ENV === 'production') {
    for (const [path, secret] of [['JWT_SECRET', value.JWT_SECRET], ['COOKIE_SECRET', value.COOKIE_SECRET]] as const) {
      if (defaultSecrets.some((item) => secret.toLowerCase().includes(item))) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message: `${path} cannot contain default/development values in production.` });
      }
    }
    if (value.CORS_ORIGINS === '*' || value.CORS_ORIGINS.split(',').some((origin) => origin.trim() === '*')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['CORS_ORIGINS'], message: 'Production CORS_ORIGINS must be explicit.' });
    }
    if (!value.COOKIE_SECURE) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['COOKIE_SECURE'], message: 'Production cookies must be secure.' });
    }
    if (!value.DATABASE_URL.startsWith('postgres://') && !value.DATABASE_URL.startsWith('postgresql://')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['DATABASE_URL'], message: 'Production DATABASE_URL must use PostgreSQL.' });
    }
  }
});

export const env = envSchema.parse(process.env);
export const corsOrigins = env.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean);
export const jwtSecrets = [env.JWT_SECRET, ...env.JWT_PREVIOUS_SECRETS.split(',').map((secret) => secret.trim()).filter(Boolean)];
export const isProduction = env.NODE_ENV === 'production';
