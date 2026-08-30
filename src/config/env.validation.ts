import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().port().default(3001),

  DATABASE_URL: Joi.string().uri().required().messages({
    'any.required': 'DATABASE_URL is required (Neon Postgres pooled URL)',
    'string.uri': 'DATABASE_URL must be a valid URI',
  }),

  CORS_ORIGIN: Joi.string()
    .required()
    .custom((value, helpers) => {
      const origins = String(value)
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean);
      if (origins.length === 0) return helpers.error('any.invalid');
      for (const origin of origins) {
        try {
          new URL(origin);
        } catch {
          return helpers.error('any.invalid');
        }
      }
      return value;
    })
    .messages({
      'any.required':
        'CORS_ORIGIN is required (comma-separated origins, e.g. http://localhost:3000)',
      'any.invalid': 'CORS_ORIGIN must be comma-separated valid URLs',
    }),

  JWT_ACCESS_SECRET: Joi.string().min(32).required().messages({
    'any.required': 'JWT_ACCESS_SECRET is required (min 32 chars)',
    'string.min': 'JWT_ACCESS_SECRET must be at least 32 characters',
  }),
  JWT_REFRESH_SECRET: Joi.string().min(32).required().messages({
    'any.required': 'JWT_REFRESH_SECRET is required (min 32 chars)',
    'string.min': 'JWT_REFRESH_SECRET must be at least 32 characters',
  }),
  JWT_RESET_SECRET: Joi.string().min(32).required().messages({
    'any.required':
      'JWT_RESET_SECRET is required (min 32 chars) — used for forgot/reset password',
    'string.min': 'JWT_RESET_SECRET must be at least 32 characters',
  }),
  JWT_ACCESS_EXPIRES_IN: Joi.string()
    .pattern(/^\d+[smhd]$/)
    .default('15m')
    .messages({
      'string.pattern.base': 'JWT_ACCESS_EXPIRES_IN must be like 15m, 1h, 7d',
    }),
  JWT_REFRESH_EXPIRES_IN: Joi.string()
    .pattern(/^\d+[smhd]$/)
    .default('7d')
    .messages({
      'string.pattern.base': 'JWT_REFRESH_EXPIRES_IN must be like 7d, 30d',
    }),

  UPSTASH_REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .required()
    .messages({
      'any.required': 'UPSTASH_REDIS_URL is required (rediss://...)',
      'string.uri': 'UPSTASH_REDIS_URL must be a valid redis URI',
    }),

  CLOUDINARY_CLOUD_NAME: Joi.string().required().messages({
    'any.required': 'CLOUDINARY_CLOUD_NAME is required',
  }),
  CLOUDINARY_API_KEY: Joi.string().required().messages({
    'any.required': 'CLOUDINARY_API_KEY is required',
  }),
  CLOUDINARY_API_SECRET: Joi.string().required().messages({
    'any.required': 'CLOUDINARY_API_SECRET is required',
  }),

  BREVO_API_KEY: Joi.string().required().messages({
    'any.required': 'BREVO_API_KEY is required',
  }),
  BREVO_SENDER_EMAIL: Joi.string().email().required().messages({
    'any.required': 'BREVO_SENDER_EMAIL is required',
    'string.email': 'BREVO_SENDER_EMAIL must be a valid email',
  }),
  BREVO_SENDER_NAME: Joi.string().allow('', null).default('Zivra'),

  API_VERSION: Joi.string().pattern(/^\d+$/).default('1').messages({
    'string.pattern.base':
      'API_VERSION must be a numeric string like "1" or "2"',
  }),
});
