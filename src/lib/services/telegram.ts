import { Telegraf, Context } from 'telegraf';
import { message } from 'telegraf/filters';
import { prisma } from '@/lib/db/prisma';
import { checkTracking, type TrackingResult } from '@/lib/services/usps';
import { checkFedExTracking } from '@/lib/services/fedex';
import { checkUpsTracking } from '@/lib/services/ups';
import {
  CARRIER_CONFIG,
  detectCarrier,
  isUspsInternationalTrackingNumber,
  resolveCarrier,
} from '@/lib/services/carriers';
import type { Carrier } from '@/lib/services/carriers';

const globalForTelegram = globalThis as typeof globalThis & {
  packageTrackerBot?: Telegraf;
  packageTrackerBotLaunching?: boolean;
};

let bot: Telegraf | null = globalForTelegram.packageTrackerBot ?? null;
let chatId: string | null = null;

type AddState =
  | { step: 'awaiting_carrier'; trackingNumber: string }
  | {
      step: 'awaiting_title_yn';
      trackingNumber: string;
      carrier: Carrier;
      prefetchedTracking?: TrackingResult;
    }
  | {
      step: 'awaiting_title';
      trackingNumber: string;
      carrier: Carrier;
      prefetchedTracking?: TrackingResult;
    };

type EditState =
  | { step: 'awaiting_title'; itemId: string; trackingNumber: string; oldTitle: string | null };

const addSessions = new Map<string, AddState>();
const editSessions = new Map<string, EditState>();

function launchBotWithRetry(instance: Telegraf, attempt = 1) {
  globalForTelegram.packageTrackerBotLaunching = true;
  instance
    .launch(() => {
      console.log('Telegram bot started (polling mode)');
    })
    .catch((err) => {
      const delayMs = Math.min(60_000, 5_000 * attempt);
      console.error(
        `Telegram bot failed to start; retrying in ${Math.round(delayMs / 1000)}s:`,
        err,
      );
      setTimeout(() => launchBotWithRetry(instance, attempt + 1), delayMs);
    });
}

function getBot(): Telegraf {
  if (!bot) throw new Error('Bot not started. Call startBot() first.');
  return bot;
}

function getChatId(): string {
  if (!chatId) {
    const cid = process.env.TELEGRAM_CHAT_ID;
    if (!cid) throw new Error('TELEGRAM_CHAT_ID not configured');
    chatId = cid;
  }
  return chatId;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function trackingLink(tn: string, carrier: string = 'USPS'): string {
  const config = CARRIER_CONFIG[carrier as Carrier] ?? CARRIER_CONFIG.USPS;
  return `<a href="${config.trackingUrl(tn)}">${escapeHtml(tn)}</a>`;
}

function carrierBadge(carrier: string): string {
  if (carrier === 'FedEx') return '🟣';
  if (carrier === 'UPS') return '🟤';
  return '🔵';
}

async function fetchAndSaveTracking(
  tn: string,
  carrier: Carrier,
  prefetchedTracking?: TrackingResult
): Promise<string> {
  try {
    const scraper =
      carrier === 'FedEx'
        ? checkFedExTracking
        : carrier === 'UPS'
          ? checkUpsTracking
          : checkTracking;
    const results = prefetchedTracking ? [prefetchedTracking] : await scraper([tn]);
    const r = results[0];
    if (!r || !r.events.length) return '';

    const latest = r.events[0];

    const item = await prisma.trackingItem.findFirst({
      where: { trackingNumber: tn, carrier },
    });
    if (item) {
      await prisma.trackingItem.update({
        where: { id: item.id },
        data: {
          lastStatus: latest.status,
          lastDetail: latest.detail,
          lastLocation: latest.location || null,
          lastStatusDate: latest.date ? new Date(latest.date) : null,
        },
      });

      for (const event of r.events) {
        const exists = await prisma.statusHistory.findFirst({
          where: {
            trackingItemId: item.id,
            eventDate: event.date,
            eventTime: event.time,
            status: event.status,
          },
        });
        if (!exists) {
          await prisma.statusHistory.create({
            data: {
              trackingItemId: item.id,
              status: event.status,
              detail: event.detail,
              location: event.location || null,
              eventDate: event.date,
              eventTime: event.time,
            },
          });
        }
      }
    }

    const parts: string[] = [];
    parts.push(`📬 <b>${escapeHtml(latest.status)}</b>`);
    if (latest.detail) parts.push(`📋 ${escapeHtml(latest.detail)}`);
    if (latest.location) parts.push(`📍 ${escapeHtml(latest.location)}`);
    return parts.join('\n');
  } catch (err) {
    console.error(`[fetchAndSaveTracking] ${carrier} ${tn} failed:`, err);
    return '';
  }
}

function hasUspsTrackingData(result: TrackingResult | undefined): result is TrackingResult {
  if (!result) return false;
  if (result.events.length > 0) return true;
  const summary = result.summary.trim();
  return Boolean(summary) && !/^(?:unknown|not found|status not available)$/i.test(summary);
}

async function verifyUspsInternationalHandoff(
  trackingNumber: string,
  carrier: Carrier
): Promise<TrackingResult | undefined | null> {
  if (carrier !== 'USPS' || !isUspsInternationalTrackingNumber(trackingNumber)) {
    return undefined;
  }

  try {
    const result = (await checkTracking([trackingNumber]))[0];
    return hasUspsTrackingData(result) ? result : null;
  } catch (err) {
    console.error(`[verifyUspsInternationalHandoff] USPS ${trackingNumber} failed:`, err);
    return null;
  }
}

async function replyNoUspsTrackingData(ctx: Context, trackingNumber: string) {
  await ctx.reply(
    `USPS did not return tracking data for <code>${escapeHtml(trackingNumber)}</code>. Check the number or try /add again later.`,
    { parse_mode: 'HTML' }
  );
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

const KNOWN_COMMANDS = ['list', 'add', 'edit', 'status', 'remove', 'pause', 'resume', 'check', 'help', 'start', 'packages'];

function suggestCommand(input: string): string | null {
  const lower = input.toLowerCase();
  let best: { cmd: string; dist: number } | null = null;

  for (const cmd of KNOWN_COMMANDS) {
    const dist = levenshtein(lower, cmd);
    if (dist <= 2 && (!best || dist < best.dist)) {
      best = { cmd, dist };
    }
  }

  if (best && best.dist <= 2) return `/${best.cmd}`;
  return null;
}

type ResolveResult =
  | { item: Awaited<ReturnType<typeof prisma.trackingItem.findUnique>>; suggestion?: never }
  | { error: string; suggestion?: string };

async function resolveTrackingRef(ref: string): Promise<ResolveResult> {
  const trimmed = ref.trim();

  if (/^\d+$/.test(trimmed)) {
    const idx = parseInt(trimmed, 10) - 1;
    const items = await prisma.trackingItem.findMany({ orderBy: { createdAt: 'desc' } });
    if (idx < 0 || idx >= items.length) {
      return { error: `Package #${trimmed} not found (1–${items.length} available).` };
    }
    return { item: items[idx] };
  }

  const tn = trimmed.toUpperCase();
  const exactItem = await prisma.trackingItem.findFirst({
    where: { trackingNumber: tn },
  });
  if (exactItem) return { item: exactItem };

  const titleItem = await prisma.trackingItem.findFirst({ where: { title: trimmed } });
  if (titleItem) return { item: titleItem };

  const all = await prisma.trackingItem.findMany({
    select: { trackingNumber: true, title: true, carrier: true },
  });

  let bestMatch: string | null = null;
  let bestDist = Infinity;

  for (const p of all) {
    const tnDist = levenshtein(tn, p.trackingNumber);
    if (tnDist <= 3 && tnDist < bestDist) {
      bestDist = tnDist;
      bestMatch = p.title
        ? `${escapeHtml(p.title)} (${trackingLink(p.trackingNumber, p.carrier)})`
        : `${trackingLink(p.trackingNumber, p.carrier)}`;
    }
    if (p.title) {
      const titleDist = levenshtein(trimmed.toLowerCase(), p.title.toLowerCase());
      if (titleDist <= 3 && titleDist < bestDist) {
        bestDist = titleDist;
        bestMatch = `${escapeHtml(p.title)} (${trackingLink(p.trackingNumber, p.carrier)})`;
      }
    }
  }

  if (bestMatch) {
    return {
      error: `Not found: <code>${escapeHtml(trimmed)}</code>`,
      suggestion: `Did you mean ${bestMatch}?`,
    };
  }

  return { error: `Tracking number <code>${escapeHtml(tn)}</code> not found.` };
}

function formatStatusBar(
  item: {
    trackingNumber: string;
    carrier: string;
    title: string | null;
    lastStatus: string | null;
    lastStatusDate: Date | null;
    lastLocation: string | null;
    active: boolean;
  },
  index: number
): string {
  const num = index + 1;
  const label = item.title || item.trackingNumber;
  const status = item.lastStatus || 'No status yet';
  const loc = item.lastLocation ? ` — ${item.lastLocation}` : '';
  const paused = item.active ? '' : ' ⏸️';
  const badge = carrierBadge(item.carrier);
  const tn = item.title ? ` ${trackingLink(item.trackingNumber, item.carrier)}` : '';
  return `${num}. ${badge} <b>${escapeHtml(label)}</b>${paused}\n   ${tn}\n   ${escapeHtml(status)}${escapeHtml(loc)}`;
}

async function isAuthorized(ctx: Context): Promise<boolean> {
  const cid = String(ctx.chat?.id || '');
  const authorized = getChatId();
  if (cid !== authorized) {
    await ctx.reply('Unauthorized. This bot is private.');
    return false;
  }
  return true;
}

async function handleList(ctx: Context) {
  const items = await prisma.trackingItem.findMany({
    orderBy: { createdAt: 'desc' },
  });

  if (items.length === 0) {
    await ctx.reply('No packages tracked. Use /add to add one.');
    return;
  }

  const lines = items.map((item, i) => formatStatusBar(item, i));
  await ctx.reply(
    `📦 <b>Your Packages (${items.length})</b>\n\n${lines.join('\n\n')}\n\n<i>Click a tracking number to open tracking</i>`,
    { parse_mode: 'HTML' }
  );
}

async function handleAdd(ctx: Context, args: string) {
  // Parse: [/add] [carrier] <tracking> [title]
  // carrier can be: usps, fedex, ups, f, u
  // If first token is a known carrier keyword, use it; otherwise treat as tracking number
  const parts = args.match(/^(\S+)(?:\s+(\S+)(?:\s+(.+))?)?$/);
  if (!parts) {
    await ctx.reply(
      'Usage: /add &lt;tracking_number&gt; [title]\nOr: /add usps|fedex|ups &lt;tracking_number&gt; [title]\nExample: /add 9400100000000000\nExample: /add fedex 123456789012\nExample: /add ups 1Z9999999999999999',
      { parse_mode: 'HTML' }
    );
    return;
  }

  let carrier: Carrier | null = null;
  let trackingNumber: string;
  let maybeTitle: string | undefined;

  const first = parts[1].trim();
  const carrierHint = first.toLowerCase();

  if (carrierHint === 'usps' || carrierHint === 'u' || carrierHint === 'fedex' || carrierHint === 'f' || carrierHint === 'fx' || carrierHint === 'ups') {
    if (!parts[2]) {
      await ctx.reply(
        'Usage: /add usps|fedex|ups &lt;tracking_number&gt; [title]',
        { parse_mode: 'HTML' }
      );
      return;
    }
    carrier = resolveCarrier(carrierHint, '') as Carrier;
    trackingNumber = parts[2].trim().toUpperCase();
    maybeTitle = parts[3]?.trim();
  } else {
    trackingNumber = first.toUpperCase();
    maybeTitle = parts[2]?.trim();
    carrier = detectCarrier(trackingNumber);
  }

  if (!carrier) {
    addSessions.set(String(ctx.chat!.id), { step: 'awaiting_carrier', trackingNumber });
    await ctx.reply(
      `Could not auto-detect carrier for <code>${escapeHtml(trackingNumber)}</code>. Reply with <b>USPS</b>, <b>FedEx</b>, or <b>UPS</b>:`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  if (!CARRIER_CONFIG[carrier].validate(trackingNumber)) {
    await ctx.reply(
      `Invalid ${carrier} tracking number format.\nUSPS: 20–22 digits or international AA123456789AA\nFedEx: 12+ digits or DT+12 digits\nUPS: 1Z + 16 letters/digits`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  const prefetchedTracking = await verifyUspsInternationalHandoff(trackingNumber, carrier);
  if (prefetchedTracking === null) {
    await replyNoUspsTrackingData(ctx, trackingNumber);
    return;
  }

  const existing = await prisma.trackingItem.findFirst({
    where: { trackingNumber, carrier },
  });

  if (existing) {
    await ctx.reply(
      `${carrierBadge(carrier)} ${trackingLink(trackingNumber, carrier)} already exists.`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  if (maybeTitle) {
    await prisma.trackingItem.create({
      data: { trackingNumber, carrier, title: maybeTitle, note: null },
    });
    const summary = await fetchAndSaveTracking(trackingNumber, carrier, prefetchedTracking);
    await ctx.reply(
      `✅ Added: <b>${escapeHtml(maybeTitle)}</b>\n${carrierBadge(carrier)} ${trackingLink(trackingNumber, carrier)}${summary ? '\n\n' + summary : ''}`,
      { parse_mode: 'HTML' }
    );
    await handleList(ctx);
    return;
  }

  addSessions.set(String(ctx.chat!.id), {
    step: 'awaiting_title_yn',
    trackingNumber,
    carrier,
    prefetchedTracking,
  });
  await ctx.reply(
    `${carrierBadge(carrier)} ${trackingLink(trackingNumber, carrier)} — Add a title? (Y/N)`,
    { parse_mode: 'HTML' }
  );
}

async function handleAddState(ctx: Context, text: string): Promise<boolean> {
  const cid = String(ctx.chat!.id);
  const session = addSessions.get(cid);
  if (!session) return false;

  if (session.step === 'awaiting_carrier') {
    const carrier = resolveCarrier(text.trim(), '');
    if (!carrier) {
      await ctx.reply('Please reply with <b>USPS</b>, <b>FedEx</b>, or <b>UPS</b>.', { parse_mode: 'HTML' });
      return true;
    }
    if (!CARRIER_CONFIG[carrier].validate(session.trackingNumber)) {
      addSessions.delete(cid);
      await ctx.reply(
        `Invalid ${carrier} tracking number: <code>${escapeHtml(session.trackingNumber)}</code>`,
        { parse_mode: 'HTML' }
      );
      return true;
    }

    const prefetchedTracking = await verifyUspsInternationalHandoff(session.trackingNumber, carrier);
    if (prefetchedTracking === null) {
      addSessions.delete(cid);
      await replyNoUspsTrackingData(ctx, session.trackingNumber);
      return true;
    }

    addSessions.set(cid, {
      step: 'awaiting_title_yn',
      trackingNumber: session.trackingNumber,
      carrier,
      prefetchedTracking,
    });
    await ctx.reply(
      `${carrierBadge(carrier)} ${trackingLink(session.trackingNumber, carrier)} — Add a title? (Y/N)`,
      { parse_mode: 'HTML' }
    );
    return true;
  }

  if (session.step === 'awaiting_title_yn') {
    const answer = text.trim().toLowerCase();
    if (answer === 'y' || answer === 'yes') {
      addSessions.set(cid, {
        step: 'awaiting_title',
        trackingNumber: session.trackingNumber,
        carrier: session.carrier,
        prefetchedTracking: session.prefetchedTracking,
      });
      await ctx.reply('Enter title:');
      return true;
    }
    if (answer === 'n' || answer === 'no') {
      addSessions.delete(cid);
      await prisma.trackingItem.create({
        data: { trackingNumber: session.trackingNumber, carrier: session.carrier, title: null, note: null },
      });
      const summary = await fetchAndSaveTracking(
        session.trackingNumber,
        session.carrier,
        session.prefetchedTracking
      );
      await ctx.reply(
        `✅ Added: ${carrierBadge(session.carrier)} ${trackingLink(session.trackingNumber, session.carrier)}${summary ? '\n\n' + summary : ''}`,
        { parse_mode: 'HTML' }
      );
      await handleList(ctx);
      return true;
    }
    await ctx.reply('Please answer Y or N. Add a title?');
    return true;
  }

  if (session.step === 'awaiting_title') {
    const title = text.trim() || null;
    addSessions.delete(cid);
    await prisma.trackingItem.create({
      data: { trackingNumber: session.trackingNumber, carrier: session.carrier, title, note: null },
    });
    const label = title || session.trackingNumber;
    const summary = await fetchAndSaveTracking(
      session.trackingNumber,
      session.carrier,
      session.prefetchedTracking
    );
    await ctx.reply(
      `✅ Added: <b>${escapeHtml(label)}</b>\n${carrierBadge(session.carrier)} ${trackingLink(session.trackingNumber, session.carrier)}${summary ? '\n\n' + summary : ''}`,
      { parse_mode: 'HTML' }
    );
    await handleList(ctx);
    return true;
  }

  return false;
}

async function handleEdit(ctx: Context, ref: string) {
  if (!ref) {
    const items = await prisma.trackingItem.findMany({ orderBy: { createdAt: 'desc' } });
    if (items.length === 0) {
      await ctx.reply('No packages to edit.');
      return;
    }
    const lines = items.map((item, i) => {
      const title = item.title || '(no title)';
      return `${i + 1}. ${carrierBadge(item.carrier)} <b>${escapeHtml(title)}</b> — ${trackingLink(item.trackingNumber, item.carrier)}`;
    });
    await ctx.reply(
      `Which package do you want to edit?\n\n${lines.join('\n')}\n\n<i>Reply with the number or tracking code</i>`,
      { parse_mode: 'HTML' }
    );
    editSessions.set(String(ctx.chat!.id), {
      step: 'awaiting_title',
      itemId: '',
      trackingNumber: '',
      oldTitle: null,
    });
    return;
  }

  const resolved = await resolveTrackingRef(ref);
  if ('error' in resolved) {
    const msg = resolved.suggestion
      ? `${resolved.error}. ${resolved.suggestion}`
      : resolved.error;
    await ctx.reply(msg, { parse_mode: 'HTML' });
    return;
  }

  const item = resolved.item!;
  editSessions.set(String(ctx.chat!.id), {
    step: 'awaiting_title',
    itemId: item.id,
    trackingNumber: item.trackingNumber,
    oldTitle: item.title,
  });

  const current = item.title ? `Current title: <b>${escapeHtml(item.title)}</b>` : 'No title set';
  await ctx.reply(
    `${current}\nEnter new title (or <code>-</code> to clear):`,
    { parse_mode: 'HTML' }
  );
}

async function handleEditState(ctx: Context, text: string): Promise<boolean> {
  const cid = String(ctx.chat!.id);
  const session = editSessions.get(cid);
  if (!session) return false;

  if (!session.itemId) {
    const resolved = await resolveTrackingRef(text);
    if ('error' in resolved) {
      const msg = resolved.suggestion
        ? `${resolved.error}. ${resolved.suggestion}`
        : resolved.error;
      await ctx.reply(msg, { parse_mode: 'HTML' });
      return true;
    }
    const item = resolved.item!;
    editSessions.set(cid, {
      step: 'awaiting_title',
      itemId: item.id,
      trackingNumber: item.trackingNumber,
      oldTitle: item.title,
    });
    const current = item.title ? `Current title: <b>${escapeHtml(item.title)}</b>` : 'No title set';
    await ctx.reply(
      `${current}\nEnter new title (or <code>-</code> to clear):`,
      { parse_mode: 'HTML' }
    );
    return true;
  }

  editSessions.delete(cid);

  const newTitle = text.trim();
  if (newTitle === '-') {
    await prisma.trackingItem.update({
      where: { id: session.itemId },
      data: { title: null },
    });
    const item = await prisma.trackingItem.findUnique({ where: { id: session.itemId } });
    await ctx.reply(
      `Title cleared for ${trackingLink(session.trackingNumber, item?.carrier ?? 'USPS')}`,
      { parse_mode: 'HTML' }
    );
    return true;
  }

  await prisma.trackingItem.update({
    where: { id: session.itemId },
    data: { title: newTitle },
  });
  const item = await prisma.trackingItem.findUnique({ where: { id: session.itemId } });
  await ctx.reply(
    `✅ Title updated: <b>${escapeHtml(newTitle)}</b>\n${trackingLink(session.trackingNumber, item?.carrier ?? 'USPS')}`,
    { parse_mode: 'HTML' }
  );
  return true;
}

async function handleRemove(ctx: Context, ref: string) {
  const refs = ref.split(/[, ]+/).filter(Boolean);
  if (refs.length === 0) {
    await ctx.reply('Usage: /remove &lt;number or tracking_number&gt;\nAccept multiple: /remove 1,3 or /remove 2 3');
    return;
  }

  const removed: string[] = [];
  const errors: string[] = [];

  for (const r of refs) {
    const resolved = await resolveTrackingRef(r);
    if ('error' in resolved) {
      errors.push(resolved.error);
      continue;
    }
    const item = resolved.item!;
    await prisma.trackingItem.delete({ where: { id: item.id } });
    removed.push(item.title || item.trackingNumber);
  }

  if (removed.length > 0) {
    await ctx.reply(
      `🗑️ Removed: <b>${removed.map((l) => escapeHtml(l)).join(', ')}</b>`,
      { parse_mode: 'HTML' }
    );
  }
  if (errors.length > 0) {
    await ctx.reply(errors.join('\n'), { parse_mode: 'HTML' });
  }

  await handleList(ctx);
}

async function handleStatus(ctx: Context, ref: string) {
  const resolved = await resolveTrackingRef(ref);
  if ('error' in resolved) {
    const msg = resolved.suggestion
      ? `${resolved.error}. ${resolved.suggestion}`
      : resolved.error;
    await ctx.reply(msg, { parse_mode: 'HTML' });
    return;
  }

  const item = resolved.item!;
  const withHistory = await prisma.trackingItem.findUnique({
    where: { id: item.id },
    include: { statusHistory: { orderBy: [{ eventDate: 'desc' }, { eventTime: 'desc' }], take: 5 } },
  });

  if (!withHistory) {
    await ctx.reply('Package not found.');
    return;
  }

  const badge = carrierBadge(withHistory.carrier);
  const label = withHistory.title || withHistory.trackingNumber;
  const paused = withHistory.active ? '' : ' (paused)';
  let msg = `${badge} 📦 <b>${escapeHtml(label)}</b>${paused}\n🔢 ${trackingLink(withHistory.trackingNumber, withHistory.carrier)}\n\n`;

  if (withHistory.lastStatus) {
    msg += `📬 <b>${escapeHtml(withHistory.lastStatus)}</b>\n`;
    if (withHistory.lastDetail) msg += `📋 ${escapeHtml(withHistory.lastDetail)}\n`;
    if (withHistory.lastLocation) msg += `📍 ${escapeHtml(withHistory.lastLocation)}\n`;
    if (withHistory.lastStatusDate) {
      msg += `🕐 ${withHistory.lastStatusDate.toLocaleDateString()} ${withHistory.lastStatusDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}\n`;
    }
  } else {
    msg += 'No status available yet.\n';
  }

  if (withHistory.statusHistory.length > 0) {
    msg += '\n<b>Recent History:</b>\n';
    for (const h of withHistory.statusHistory) {
      msg += `• ${escapeHtml(h.status)} — ${h.eventDate} ${h.eventTime}\n`;
    }
  }

  await ctx.reply(msg, { parse_mode: 'HTML' });
}

async function handlePause(ctx: Context, ref: string, pause: boolean) {
  const resolved = await resolveTrackingRef(ref);
  if ('error' in resolved) {
    const msg = resolved.suggestion
      ? `${resolved.error}. ${resolved.suggestion}`
      : resolved.error;
    await ctx.reply(msg, { parse_mode: 'HTML' });
    return;
  }

  const item = resolved.item!;
  await prisma.trackingItem.update({ where: { id: item.id }, data: { active: !pause } });
  const label = item.title || item.trackingNumber;
  const action = pause ? 'paused' : 'resumed';
  await ctx.reply(`⏸️ <b>${escapeHtml(label)}</b> ${action}.`, { parse_mode: 'HTML' });
}

async function handleCheckNow(ctx: Context, ref?: string) {
  if (ref) {
    const resolved = await resolveTrackingRef(ref);
    if ('error' in resolved) {
      const msg = resolved.suggestion
        ? `${resolved.error}. ${resolved.suggestion}`
        : resolved.error;
      await ctx.reply(msg, { parse_mode: 'HTML' });
      return;
    }

    const item = resolved.item!;
    const label = item.title || item.trackingNumber;
    await ctx.reply(`🔍 Checking <b>${escapeHtml(label)}</b>...`, { parse_mode: 'HTML' });

    try {
      const summary = await fetchAndSaveTracking(item.trackingNumber, item.carrier as Carrier);
      const refreshed = await prisma.trackingItem.findUnique({ where: { id: item.id } });
      if (!refreshed) {
        await ctx.reply('Package not found after check.');
        return;
      }
      const badge = carrierBadge(refreshed.carrier);
      const status = refreshed.lastStatus || 'No status';
      const loc = refreshed.lastLocation ? `\n📍 ${escapeHtml(refreshed.lastLocation)}` : '';
      const detail = refreshed.lastDetail ? `\n📋 ${escapeHtml(refreshed.lastDetail)}` : '';
      await ctx.reply(
        `${badge} <b>${escapeHtml(refreshed.title || refreshed.trackingNumber)}</b>\n📬 ${escapeHtml(status)}${detail}${loc}`,
        { parse_mode: 'HTML' }
      );
    } catch (err: any) {
      await ctx.reply(`Error checking package: ${err.message}`);
    }
    return;
  }

  await ctx.reply('🔍 Checking all packages now...');
  try {
    const { runTrackingCheck } = await import('@/jobs/tracking-check');
    await runTrackingCheck();
    await handleList(ctx);
  } catch (err: any) {
    await ctx.reply(`Error: ${err.message}`);
  }
}

export function startBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn('TELEGRAM_BOT_TOKEN not configured. Bot not started.');
    return;
  }

  if (globalForTelegram.packageTrackerBot || globalForTelegram.packageTrackerBotLaunching) {
    bot = globalForTelegram.packageTrackerBot ?? bot;
    return;
  }

  bot = new Telegraf(token);
  globalForTelegram.packageTrackerBot = bot;

  bot.use(async (ctx, next) => {
    if (!(await isAuthorized(ctx))) return;
    await next();
  });

  bot.start(async (ctx) => {
    await ctx.reply(
      'Welcome to Package Tracking Bot!\n\n' +
        'Supports USPS, FedEx, and UPS.\n\n' +
        'Commands:\n' +
        '/list — List all packages (numbered)\n' +
        '/add &lt;tracking&gt; [title] — Add a package (auto-detect carrier)\n' +
        '/add usps|fedex|ups &lt;tracking&gt; [title] — Add with explicit carrier\n' +
        '/edit [number or tracking] — Change a package title\n' +
        '/status &lt;number or tracking&gt; — Get detailed status\n' +
        '/remove &lt;number or tracking&gt; — Remove a package (multi: /remove 1,3)\n' +
        '/pause &lt;number or tracking&gt; — Pause tracking\n' +
        '/resume &lt;number or tracking&gt; — Resume tracking\n' +
        '/check [number or tracking] — Force check (all or one)\n\n' +
        'Tip: Use numbers from /list, e.g. /status 1',
      { parse_mode: 'HTML' },
    );
  });

  bot.command('list', (ctx) => handleList(ctx));
  bot.command('packages', (ctx) => handleList(ctx));

  bot.command('add', async (ctx) => {
    const args = ctx.message.text.replace(/^\/add\s*/, '').trim();
    if (!args) {
      await ctx.reply('Usage: /add &lt;tracking_number&gt; [title]\nOr: /add usps|fedex|ups &lt;tracking_number&gt; [title]');
      return;
    }
    await handleAdd(ctx, args);
  });

  bot.command('remove', async (ctx) => {
    const args = ctx.message.text.replace(/^\/remove\s*/, '').trim();
    if (!args) {
      await ctx.reply('Usage: /remove &lt;number or tracking_number&gt;\nMultiple: /remove 1,3 or /remove 2 3');
      return;
    }
    await handleRemove(ctx, args);
  });

  bot.command('status', async (ctx) => {
    const args = ctx.message.text.replace(/^\/status\s*/, '').trim();
    if (!args) {
      await ctx.reply('Usage: /status &lt;number or tracking_number&gt;');
      return;
    }
    await handleStatus(ctx, args);
  });

  bot.command('pause', async (ctx) => {
    const args = ctx.message.text.replace(/^\/pause\s*/, '').trim();
    if (!args) {
      await ctx.reply('Usage: /pause &lt;number or tracking_number&gt;');
      return;
    }
    await handlePause(ctx, args, true);
  });

  bot.command('resume', async (ctx) => {
    const args = ctx.message.text.replace(/^\/resume\s*/, '').trim();
    if (!args) {
      await ctx.reply('Usage: /resume &lt;number or tracking_number&gt;');
      return;
    }
    await handlePause(ctx, args, false);
  });

  bot.command('check', async (ctx) => {
    const args = ctx.message.text.replace(/^\/check\s*/, '').trim();
    await handleCheckNow(ctx, args || undefined);
  });

  bot.command('edit', async (ctx) => {
    const args = ctx.message.text.replace(/^\/edit\s*/, '').trim();
    await handleEdit(ctx, args);
  });

  bot.command('help', (ctx) =>
    ctx.reply(
      'Commands:\n' +
        '/list — List all packages (numbered)\n' +
        '/add &lt;tracking&gt; [title] — Add a package (auto-detect)\n' +
        '/add usps|fedex|ups &lt;tracking&gt; [title] — Explicit carrier\n' +
        '/edit [number or tracking] — Change a package title\n' +
        '/status &lt;number or tracking&gt; — Get detailed status\n' +
        '/remove &lt;number or tracking&gt; — Remove a package (multi: /remove 1,3)\n' +
        '/pause &lt;number or tracking&gt; — Pause tracking\n' +
        '/resume &lt;number or tracking&gt; — Resume tracking\n' +
        '/check [number or tracking] — Force check (all or one)\n\n' +
        'Tip: Use numbers from /list, e.g. /status 1',
    ),
  );

  bot.on(message('text'), async (ctx) => {
    const text = ctx.message.text;

    if (text.startsWith('/')) {
      addSessions.delete(String(ctx.chat!.id));
      editSessions.delete(String(ctx.chat!.id));

      const cmdName = text.split(/\s+/)[0].replace(/^\/+/, '').split('@')[0].toLowerCase();
      const suggestion = suggestCommand(cmdName);
      if (suggestion) {
        await ctx.reply(`Unknown command. Did you mean <b>${suggestion}</b>?`, { parse_mode: 'HTML' });
      }
      return;
    }

    if (await handleAddState(ctx, text)) return;
    if (await handleEditState(ctx, text)) return;

    await ctx.reply(
      'Use commands:\n/list • /add • /edit • /status • /remove • /pause • /resume • /check',
    );
  });

  bot.catch((err: any) => {
    console.error('Telegram bot error:', err);
  });

  launchBotWithRetry(bot);

  process.once('SIGINT', () => { bot?.stop('SIGINT'); });
  process.once('SIGTERM', () => { bot?.stop('SIGTERM'); });
}

export async function sendStatusUpdate(
  trackingNumber: string,
  title: string | null,
  carrier: string,
  status: string,
  detail: string,
  location: string,
  date: string,
  time: string
) {
  const label = title || trackingNumber;
  const loc = location ? `📍 ${location}` : '';
  const when = date && time ? `🕐 ${date} ${time}` : '';
  const badge = carrierBadge(carrier);

  const message = [
    `${badge} 📦 <b>${escapeHtml(label)}</b>`,
    `🔢 ${trackingLink(trackingNumber, carrier)}`,
    `📬 <b>${escapeHtml(status)}</b>`,
    detail && `📋 ${escapeHtml(detail)}`,
    loc,
    when,
  ].filter(Boolean).join('\n');

  try {
    await getBot().telegram.sendMessage(getChatId(), message, { parse_mode: 'HTML' });
  } catch (err) {
    console.error('Failed to send Telegram notification:', err);
  }
}

export async function sendBatchNotification(
  updates: Array<{
    trackingNumber: string;
    title: string | null;
    carrier?: string;
    status: string;
    detail: string;
    location: string;
    date: string;
    time: string;
  }>
) {
  if (updates.length === 0) return;

  if (updates.length === 1) {
    const u = updates[0];
    await sendStatusUpdate(u.trackingNumber, u.title, u.carrier ?? 'USPS', u.status, u.detail, u.location, u.date, u.time);
    return;
  }

  const lines = updates.map((u) => {
    const label = u.title ? `${u.title} (${u.trackingNumber})` : u.trackingNumber;
    const badge = carrierBadge(u.carrier ?? 'USPS');
    return `${badge} • <b>${escapeHtml(label)}</b>: ${escapeHtml(u.status)}`;
  });

  const message = [`📬 <b>${updates.length} tracking updates</b>`, '', ...lines].join('\n');

  try {
    await getBot().telegram.sendMessage(getChatId(), message, { parse_mode: 'HTML' });
  } catch (err) {
    console.error('Failed to send Telegram batch notification:', err);
  }
}
