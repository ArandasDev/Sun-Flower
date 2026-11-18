import { SIGNAL_NAMES } from '../config.ts';
import type { ModerationConfig, SignalName } from '../config.ts';
import { MAX_SCANNED_CHARS, extractLinks } from './links.ts';
import { PROTECTED_BRANDS, isLookalike } from './lookalike.ts';
import type { MultiChannelTracker } from './multi-channel.ts';

/** Both methods already take parent domains into account. */
export interface DomainLists {
  isBlocked(domain: string): boolean;
  isAllowed(domain: string): boolean;
}

export interface AnalysisInput {
  content: string;
  authorId: string;
  channelId: string;
  authorAccountCreatedAt: string;
  authorJoinedAt: string | null;
  now: Date;
}

export interface Signal {
  name: SignalName;
  points: number;
}

export interface Analysis {
  score: number;
  level: 'confirmed' | 'suspicious' | undefined;
  signals: Signal[];
  /** Distinct non-allowed domains, in order of appearance. */
  domains: string[];
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Distinct non-allowed domains analyzed per message; allowed ones do not count. */
const MAX_ANALYZED_DOMAINS = 20;
const MASS_MENTION = /@(?:everyone|here)(?![\p{L}\p{N}_])/u;

const SCHEME_URL = /https?:\/\/\S+/gi;
const DOTTED_TOKEN = /(?<![\p{L}\p{N}-])[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;

/** Lowercases and drops accents and invisible format characters (zero-width, soft hyphen). */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\p{M}\p{Cf}]/gu, '')
    .toLowerCase();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Naming the brand is ordinary talk ("compra na steam"), not bait. */
const BRAND_NAMES: ReadonlySet<string> = new Set(PROTECTED_BRANDS.map((b) => fold(b.brand)));

function hasBait(content: string, terms: readonly string[]): boolean {
  // Link text is not message text: "discord.gift" must not match the "gift" bait.
  const haystack = fold(content).replace(SCHEME_URL, ' ').replace(DOTTED_TOKEN, ' ');
  return terms.some((term) => {
    const needle = fold(term).trim();
    if (needle === '' || BRAND_NAMES.has(needle)) return false;
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(needle)}(?![\\p{L}\\p{N}])`, 'u');
    return pattern.test(haystack);
  });
}

function isNewAuthor(input: AnalysisInput, config: ModerationConfig): boolean {
  const nowMs = input.now.getTime();
  const created = Date.parse(input.authorAccountCreatedAt);
  if (!Number.isNaN(created) && nowMs - created < config.newAccountDays * DAY_MS) return true;
  if (input.authorJoinedAt === null) return false;
  const joined = Date.parse(input.authorJoinedAt);
  return !Number.isNaN(joined) && nowMs - joined < config.newMemberHours * HOUR_MS;
}

export function analyzeMessage(
  input: AnalysisInput,
  deps: { lists: DomainLists; config: ModerationConfig; tracker: MultiChannelTracker },
): Analysis {
  const { lists, config, tracker } = deps;
  const content = input.content.slice(0, MAX_SCANNED_CHARS);
  const links = extractLinks(content);

  const domains: string[] = [];
  let blocked = false;
  let lookalike = false;
  let masked = false;
  for (const link of links) {
    const isBlocked = lists.isBlocked(link.domain);
    if (!isBlocked && lists.isAllowed(link.domain)) continue;
    if (!domains.includes(link.domain)) {
      if (domains.length === MAX_ANALYZED_DOMAINS) continue;
      domains.push(link.domain);
    }
    if (isBlocked) blocked = true;
    if (isLookalike(link.domain)) lookalike = true;
    if (link.maskedTextDomain !== undefined) masked = true;
  }

  if (domains.length === 0) return { score: 0, level: undefined, signals: [], domains };

  const nowMs = input.now.getTime();
  const windowMs = config.multiChannel.windowSeconds * 1000;
  let multiChannel = false;
  for (const domain of domains) {
    const channels = tracker.record(input.authorId, domain, input.channelId, nowMs, windowMs);
    if (channels >= config.multiChannel.channels) multiChannel = true;
  }

  const fired: Record<SignalName, boolean> = {
    blocked,
    lookalike,
    masked,
    multiChannel,
    bait: hasBait(content, config.baitTerms),
    massMention: MASS_MENTION.test(content),
    newAccount: isNewAuthor(input, config),
  };

  const signals: Signal[] = SIGNAL_NAMES.filter((name) => fired[name]).map((name) => ({
    name,
    points: config.weights[name],
  }));
  const score = signals.reduce((sum, s) => sum + s.points, 0);
  let level: Analysis['level'];
  if (score >= config.thresholds.confirmed) level = 'confirmed';
  else if (score >= config.thresholds.suspicious) level = 'suspicious';
  return { score, level, signals, domains };
}
