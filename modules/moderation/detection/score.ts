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
  /**
   * Up to 20 distinct non-allowed domains: blocked, then lookalike, then masked, then the rest,
   * each group in order of appearance (clickable links first).
   */
  domains: string[];
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/**
 * Every non-allowed link is evaluated; only the domains list (stored in the case and shown in
 * the alert) and the multi-channel tracking are capped, to keep storage and memory bounded.
 */
const MAX_LISTED_DOMAINS = 20;
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

  // Per distinct non-allowed domain, in order of appearance: 0 blocked, 1 lookalike, 2 masked, 3 none.
  const rank = new Map<string, number>();
  let blocked = false;
  let lookalike = false;
  let masked = false;
  for (const link of links) {
    const isBlocked = lists.isBlocked(link.domain);
    if (!isBlocked && lists.isAllowed(link.domain)) continue;
    const isMasked = link.maskedTextDomain !== undefined;
    let domainRank = rank.get(link.domain);
    if (domainRank === undefined) {
      const isLook = isLookalike(link.domain);
      domainRank = isBlocked ? 0 : isLook ? 1 : 3;
      if (isBlocked) blocked = true;
      if (isLook) lookalike = true;
    }
    if (isMasked) masked = true;
    rank.set(link.domain, Math.min(domainRank, isMasked ? 2 : 3));
  }

  const ordered = [...rank.keys()];
  if (ordered.length === 0) return { score: 0, level: undefined, signals: [], domains: [] };
  const domains = ordered
    .map((domain, index) => ({ domain, index, rank: rank.get(domain) ?? 3 }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, MAX_LISTED_DOMAINS)
    .map((d) => d.domain);

  const nowMs = input.now.getTime();
  const windowMs = config.multiChannel.windowSeconds * 1000;
  let multiChannel = false;
  // Tracks the listed domains (signalled first), so fillers cannot push the real one out.
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
