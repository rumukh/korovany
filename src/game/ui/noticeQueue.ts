import { HINT_MIN_GAP_SECONDS } from '../content/hints.ts'
import type { NoticeOrigin, NoticeTone } from '../types.ts'
import type { HudMode } from '../visualSettings.ts'

/**
 * W3-6 — when a notice goes on screen, for how long, and which one waits.
 *
 * The engine and the App speak through one notice channel, and they speak in bursts: a
 * launch, a camp choice, an achievement and a first-time line can land in the same second.
 * The old stack kept the newest four and silently threw the rest away, each on a 4.3 s
 * wall-clock timer that kept running behind the pause menu and through load stalls. Here a
 * burst queues instead: a fixed number show at once, the most urgent first, repeats merge
 * into one line, and the clock this module is given is the App's painted, unpaused time.
 *
 * First-time lines get a place of their own. The hint director already paces them, and a
 * fresh profile's opening releases one every few seconds; sharing one slot with the news,
 * either the lessons or the news starved (measured: info hints waited up to 90 s behind
 * warband warnings). So a hint never waits for a notice, and a notice never waits for a hint.
 *
 * Everything below is pure: time is an argument, so the same calls give the same queue.
 */

/** How many notices and how many first-time lines may be on screen at once. */
export interface NoticeLimits {
  readonly notices: number
  readonly hints: number
}

/** Where the HUD has room: three long lines end above the player at 1366x768. */
export const WIDE_NOTICE_LIMITS: NoticeLimits = { notices: 2, hints: 1 }
/** The narrow layout's lane at the foot of the left column holds one of each. */
export const NARROW_NOTICE_LIMITS: NoticeLimits = { notices: 1, hints: 1 }

/** The old fixed life, kept as the floor. */
export const NOTICE_MIN_LIFETIME_MS = 4300
/**
 * The ceiling. Below the hint gap on purpose: a first-time line is always gone before the
 * director may release the next one, so two never share the stack.
 */
export const NOTICE_MAX_LIFETIME_MS = 5800
const NOTICE_BASE_MS = 1500
const NOTICE_MS_PER_CHAR = 22

/** How long a notice stays up before a more urgent one may take its slot. */
export const NOTICE_MIN_DWELL_MS = 1200
/** A displaced notice with less than this left has been read; it retires instead of returning. */
export const NOTICE_MIN_RESUME_MS = 1500
/** Plain info that waited this long describes a moment that has passed. Hints never go stale. */
export const NOTICE_STALE_INFO_MS = 10_000
/** A safety cap on the line. It never costs a hint or a danger notice. */
export const NOTICE_MAX_WAITING = 12
/** The App's clock counts at most this much of one frame, so a stall does not age a notice. */
export const NOTICE_FRAME_CAP_MS = 250
export const HINT_NOTICE_GAP_MS = HINT_MIN_GAP_SECONDS * 1000

/** The CSS's narrow HUD media query, verbatim: the lane and the limits follow the same layout. */
export const NARROW_HUD_QUERY = '(max-width: 720px), (pointer: coarse)'

/** Danger, then warnings, then rewards, then everything else. */
export const NOTICE_TONE_RANK: Readonly<Record<NoticeTone, number>> = {
  info: 0,
  success: 1,
  warning: 2,
  danger: 3,
}

/** What the HUD draws. */
export interface NoticeView {
  id: number
  message: string
  tone: NoticeTone
  /** How many identical notices this line stands for, itself included. */
  count: number
}

export interface WaitingNotice extends NoticeView {
  hint: boolean
  /** The latest arrival, so a repeat keeps a waiting line fresh. */
  arrivedAt: number
  /** The life a displaced notice still had; `null` until it has been displaced. */
  remainingMs: number | null
  /** Shown before: a line coming back to the screen does not wait out the hint gap again. */
  seen: boolean
}

export interface ShownNotice extends WaitingNotice {
  shownAt: number
  expiresAt: number
}

export interface NoticeQueueStats {
  arrived: number
  merged: number
  preempted: number
  dropped: number
  expired: number
}

export interface NoticeQueue {
  readonly nextId: number
  /** On screen, in the order they went up. */
  readonly shown: readonly ShownNotice[]
  readonly waiting: readonly WaitingNotice[]
  /** When the last first-time line went on screen. */
  readonly lastHintAt: number | null
  readonly stats: NoticeQueueStats
}

export interface NoticeInput {
  message: string
  tone: NoticeTone
  origin?: NoticeOrigin
}

export type NoticeLane = 'column' | 'side' | 'screen'

export function noticeLifetimeMs(message: string): number {
  return Math.min(
    NOTICE_MAX_LIFETIME_MS,
    Math.max(NOTICE_MIN_LIFETIME_MS, NOTICE_BASE_MS + message.length * NOTICE_MS_PER_CHAR),
  )
}

export function noticeLimitsFor(narrow: boolean): NoticeLimits {
  return narrow ? NARROW_NOTICE_LIMITS : WIDE_NOTICE_LIMITS
}

/**
 * Where the one live region sits. Narrow layouts, in either mode, use the foot of the left
 * column; wide ones keep GFX-05's places: Compact's top HUD column, Full's game screen.
 */
export function noticeLaneFor(hudMode: HudMode, narrow: boolean): NoticeLane {
  if (narrow) return 'column'
  return hudMode === 'compact' ? 'side' : 'screen'
}

/** `?noticeLog=1` records every arrival for a run report, as `?graphicsDiagnostics=1` does for graphics. */
export function noticeLogEnabled(search: string): boolean {
  return new URLSearchParams(search).get('noticeLog') === '1'
}

export function createNoticeQueue(): NoticeQueue {
  return {
    nextId: 1,
    shown: [],
    waiting: [],
    lastHintAt: null,
    stats: { arrived: 0, merged: 0, preempted: 0, dropped: 0, expired: 0 },
  }
}

const rank = (notice: NoticeView): number => NOTICE_TONE_RANK[notice.tone]
const sameLine = (notice: NoticeView, input: NoticeInput): boolean =>
  notice.message === input.message && notice.tone === input.tone

/** First in line: the most urgent, then the one that arrived first. */
function compareWaiting(first: WaitingNotice, second: WaitingNotice): number {
  return rank(second) - rank(first) || first.id - second.id
}

/** The one that gives up its slot: the least urgent, and of those the one up longest. */
function weakest(shown: readonly ShownNotice[]): ShownNotice | undefined {
  return [...shown].sort((first, second) => rank(first) - rank(second) || first.shownAt - second.shownAt)[0]
}

function displace(notice: ShownNotice, now: number): WaitingNotice | null {
  const remaining = notice.expiresAt - now
  if (remaining < NOTICE_MIN_RESUME_MS) return null
  return {
    id: notice.id,
    message: notice.message,
    tone: notice.tone,
    count: notice.count,
    hint: notice.hint,
    arrivedAt: now,
    remainingMs: remaining,
    seen: true,
  }
}

function show(notice: WaitingNotice, now: number): ShownNotice {
  const life = notice.remainingMs ?? noticeLifetimeMs(notice.message)
  return { ...notice, remainingMs: null, seen: true, shownAt: now, expiresAt: now + life }
}

function isStale(notice: WaitingNotice, now: number): boolean {
  return !notice.hint && notice.tone === 'info' && now - notice.arrivedAt >= NOTICE_STALE_INFO_MS
}

function hintMayShow(notice: WaitingNotice, lastHintAt: number | null, now: number): boolean {
  return notice.seen || lastHintAt === null || now - lastHintAt >= HINT_NOTICE_GAP_MS
}

/**
 * Expires, drops stale info, fits the limits and fills free places. Hints take the hint
 * place in arrival order, after the gap; notices take theirs by urgency, and a more urgent
 * one may take the place of a calmer notice that has had its minimum time. Returns the same
 * object when nothing changes, so a caller can skip a render.
 */
export function advanceNotices(queue: NoticeQueue, now: number, limits: NoticeLimits): NoticeQueue {
  let shown = queue.shown.filter((notice) => notice.expiresAt > now)
  let waiting = queue.waiting.filter((notice) => !isStale(notice, now))
  let { lastHintAt } = queue
  const stats = { ...queue.stats }
  stats.expired += queue.shown.length - shown.length
  stats.dropped += queue.waiting.length - waiting.length
  let changed = shown.length !== queue.shown.length || waiting.length !== queue.waiting.length

  for (const hint of [false, true]) {
    const slots = Math.max(0, Math.floor(hint ? limits.hints : limits.notices))
    const mine = () => shown.filter((notice) => notice.hint === hint)
    while (mine().length > slots) {
      const victim = weakest(mine())
      if (!victim) break
      shown = shown.filter((notice) => notice !== victim)
      const back = displace(victim, now)
      if (back) waiting = [...waiting, back]
      else stats.expired += 1
      changed = true
    }

    for (;;) {
      const candidates = waiting.filter((notice) => notice.hint === hint &&
        (!hint || hintMayShow(notice, lastHintAt, now)))
      const next = hint ? candidates.sort((first, second) => first.id - second.id)[0]
        : candidates.sort(compareWaiting)[0]
      if (!next) break
      if (mine().length >= slots) {
        if (hint) break
        const victim = weakest(mine().filter((notice) =>
          rank(notice) < rank(next) && now - notice.shownAt >= NOTICE_MIN_DWELL_MS))
        if (!victim) break
        shown = shown.filter((notice) => notice !== victim)
        const back = displace(victim, now)
        if (back) waiting = [...waiting, back]
        stats.preempted += 1
      }
      waiting = waiting.filter((notice) => notice !== next)
      shown = [...shown, show(next, now)]
      if (hint) lastHintAt = now
      changed = true
    }
  }

  if (!changed) return queue
  return { ...queue, shown, waiting, lastHintAt, stats }
}

/** One arrival: merged into an identical line if one is up or waiting, else queued. */
export function pushNotice(queue: NoticeQueue, input: NoticeInput, now: number, limits: NoticeLimits): NoticeQueue {
  const stats = { ...queue.stats }
  const shownMatch = queue.shown.find((notice) => sameLine(notice, input))
  if (shownMatch) {
    stats.merged += 1
    const shown = queue.shown.map((notice) => notice === shownMatch ? {
      ...notice,
      count: notice.count + 1,
      arrivedAt: now,
      expiresAt: Math.max(notice.expiresAt, now + noticeLifetimeMs(notice.message)),
    } : notice)
    return advanceNotices({ ...queue, shown, stats }, now, limits)
  }
  const waitingMatch = queue.waiting.find((notice) => sameLine(notice, input))
  if (waitingMatch) {
    stats.merged += 1
    const waiting = queue.waiting.map((notice) => notice === waitingMatch
      ? { ...notice, count: notice.count + 1, arrivedAt: now }
      : notice)
    return advanceNotices({ ...queue, waiting, stats }, now, limits)
  }

  stats.arrived += 1
  let waiting: WaitingNotice[] = [...queue.waiting, {
    id: queue.nextId,
    message: input.message,
    tone: input.tone,
    count: 1,
    hint: input.origin === 'hint',
    arrivedAt: now,
    remainingMs: null,
    seen: false,
  }]
  while (waiting.length > NOTICE_MAX_WAITING) {
    const victim = waiting
      .filter((notice) => !notice.hint && notice.tone !== 'danger')
      .sort((first, second) => rank(first) - rank(second) || first.id - second.id)[0]
    if (!victim) break
    waiting = waiting.filter((notice) => notice !== victim)
    stats.dropped += 1
  }
  return advanceNotices({ ...queue, nextId: queue.nextId + 1, waiting, stats }, now, limits)
}

/**
 * After `advanceNotices(queue, now)`, the next time it could change anything: an expiry, a
 * stale line, the end of the hint gap or of a minimum dwell. `null` when nothing is pending.
 */
export function nextNoticeDeadline(queue: NoticeQueue, limits: NoticeLimits, now: number): number | null {
  const hints = queue.shown.filter((notice) => notice.hint).length
  if (hints > limits.hints || queue.shown.length - hints > limits.notices) return now
  const times: number[] = queue.shown.map((notice) => notice.expiresAt)
  for (const notice of queue.waiting) {
    if (notice.hint) {
      if (!notice.seen && queue.lastHintAt !== null) times.push(queue.lastHintAt + HINT_NOTICE_GAP_MS)
      continue
    }
    if (notice.tone === 'info') times.push(notice.arrivedAt + NOTICE_STALE_INFO_MS)
    for (const entry of queue.shown) {
      if (!entry.hint && rank(entry) < rank(notice)) times.push(entry.shownAt + NOTICE_MIN_DWELL_MS)
    }
  }
  const future = times.filter((time) => time > now)
  return future.length > 0 ? Math.min(...future) : null
}

/** Drawn notices in the order they went up, without the bookkeeping. */
export function noticeViews(queue: NoticeQueue): NoticeView[] {
  return queue.shown.map(({ id, message, tone, count }) => ({ id, message, tone, count }))
}
