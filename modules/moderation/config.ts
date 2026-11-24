import { z } from 'zod';

export const SIGNAL_NAMES = [
  'blocked',
  'lookalike',
  'masked',
  'multiChannel',
  'bait',
  'massMention',
  'newAccount',
] as const;

export type SignalName = (typeof SIGNAL_NAMES)[number];

export const DEFAULT_WEIGHTS: Record<SignalName, number> = {
  blocked: 100,
  lookalike: 60,
  masked: 40,
  multiChannel: 50,
  bait: 30,
  massMention: 20,
  newAccount: 15,
};

export const DEFAULT_BAIT_TERMS: readonly string[] = [
  'nitro',
  'free',
  'grátis',
  'gratis',
  'gift',
  'presente',
  'airdrop',
  'giveaway',
  'sorteio',
  'claim',
  'resgate',
];

export const snowflake = z.string().regex(/^\d{17,20}$/);
const weight = z.number().int().min(0).max(1000);

const thresholdsSchema = z.object({
  confirmed: z.number().int().min(1).max(1000).default(80),
  suspicious: z.number().int().min(1).max(1000).default(40),
});

const weightsSchema = z.object({
  blocked: weight.default(DEFAULT_WEIGHTS.blocked),
  lookalike: weight.default(DEFAULT_WEIGHTS.lookalike),
  masked: weight.default(DEFAULT_WEIGHTS.masked),
  multiChannel: weight.default(DEFAULT_WEIGHTS.multiChannel),
  bait: weight.default(DEFAULT_WEIGHTS.bait),
  massMention: weight.default(DEFAULT_WEIGHTS.massMention),
  newAccount: weight.default(DEFAULT_WEIGHTS.newAccount),
});

const multiChannelSchema = z.object({
  channels: z.number().int().min(2).max(25).default(3),
  windowSeconds: z.number().int().min(10).max(3600).default(60),
});

export const SPAM_RULES = ['flood', 'repeat', 'mentions'] as const;

export type SpamRuleName = (typeof SPAM_RULES)[number];

export type Punishment =
  { kind: 'none' } | { kind: 'timeout'; minutes: number } | { kind: 'kick' } | { kind: 'ban' };

const spamLimit = z.number().int().min(2).max(50);
const spamSeconds = z.number().int().min(2).max(600);
const deleteMinutes = z.number().int().min(0).max(60);
const punishment = z.enum(['none', 'timeout', 'kick', 'ban']);
const timeoutMinutes = z.number().int().min(1).max(40320);

const floodSchema = z.object({
  enabled: z.boolean().default(true),
  limit: spamLimit.default(7),
  seconds: spamSeconds.default(5),
  deleteMinutes: deleteMinutes.default(2),
  punishment: punishment.default('timeout'),
  timeoutMinutes: timeoutMinutes.default(10),
});

const repeatSchema = z.object({
  enabled: z.boolean().default(true),
  limit: spamLimit.default(4),
  seconds: spamSeconds.default(60),
  deleteMinutes: deleteMinutes.default(10),
  punishment: punishment.default('timeout'),
  timeoutMinutes: timeoutMinutes.default(10),
});

const mentionsSchema = z.object({
  enabled: z.boolean().default(true),
  limit: spamLimit.default(6),
  deleteMinutes: deleteMinutes.default(0),
  punishment: punishment.default('timeout'),
  timeoutMinutes: timeoutMinutes.default(10),
});

const escalationStepSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('timeout'), minutes: timeoutMinutes }),
  z.object({ kind: z.literal('kick') }),
  z.object({ kind: z.literal('ban') }),
]);

// Compile-time check: a parsed escalation step is always a valid Punishment.
const _stepIsPunishment: (step: z.output<typeof escalationStepSchema>) => Punishment = (step) =>
  step;
void _stepIsPunishment;

const escalationSchema = z.object({
  enabled: z.boolean().default(true),
  windowHours: z.number().int().min(1).max(168).default(24),
  steps: z
    .array(escalationStepSchema)
    .min(1)
    .max(5)
    .default([{ kind: 'timeout', minutes: 10 }, { kind: 'timeout', minutes: 60 }, { kind: 'ban' }]),
});

const spamSchema = z.object({
  ignoredChannelIds: z.array(snowflake).max(25).default([]),
  flood: floodSchema.default(() => floodSchema.parse({})),
  repeat: repeatSchema.default(() => repeatSchema.parse({})),
  mentions: mentionsSchema.default(() => mentionsSchema.parse({})),
  escalation: escalationSchema.default(() => escalationSchema.parse({})),
});

export const configSchema = z
  .object({
    alertChannelId: snowflake.optional(),
    timeoutMinutes: z.number().int().min(1).max(40320).default(60),
    thresholds: thresholdsSchema.default({ confirmed: 80, suspicious: 40 }),
    weights: weightsSchema.default({ ...DEFAULT_WEIGHTS }),
    exemptRoleIds: z.array(snowflake).max(25).default([]),
    newAccountDays: z.number().int().min(0).max(365).default(7),
    newMemberHours: z.number().int().min(0).max(720).default(24),
    multiChannel: multiChannelSchema.default({ channels: 3, windowSeconds: 60 }),
    baitTerms: z
      .array(z.string().min(1).max(32))
      .max(100)
      .default([...DEFAULT_BAIT_TERMS]),
    spam: spamSchema.default(() => spamSchema.parse({})),
  })
  .refine((config) => config.thresholds.confirmed > config.thresholds.suspicious, {
    path: ['thresholds'],
    message: 'thresholds.confirmed must be greater than thresholds.suspicious',
  });

export type ModerationConfig = z.output<typeof configSchema>;
