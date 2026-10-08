import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  ABILITY_BLOCKED_NO_STAMINA_NOTICE,
  HINT_IDS,
  NIGHT_FALL_NOTICE,
  describeCaravanOfferChosen,
  describeEventStarted,
  describeHint,
  describeLimbLost,
  describeObjectiveCompleted,
  describeZoneDiscovered,
  type HintId,
} from '../src/game/content/gameCopy.ts'
import { HINT_MIN_GAP_SECONDS } from '../src/game/content/hints.ts'
import type { NoticeOrigin, NoticeTone } from '../src/game/types.ts'
import {
  COLUMN_LANE_QUERY,
  HINT_NOTICE_GAP_MS,
  LOOT_NOTICE_LIFETIME_MS,
  NARROW_NOTICE_LIMITS,
  NOTICE_MAX_LIFETIME_MS,
  NOTICE_MAX_WAITING,
  NOTICE_MIN_DWELL_MS,
  NOTICE_MIN_LIFETIME_MS,
  NOTICE_STALE_INFO_MS,
  WIDE_NOTICE_LIMITS,
  advanceNotices,
  createNoticeQueue,
  nextNoticeDeadline,
  noticeLaneFor,
  noticeLifetimeMs,
  noticeLimitsFor,
  noticeLogEnabled,
  noticeViews,
  pushNotice,
  settingNoticeWanted,
  type NoticeArt,
  type NoticeLimits,
} from '../src/game/ui/noticeQueue.ts'

interface Arrival {
  at: number
  message: string
  tone: NoticeTone
  origin?: NoticeOrigin
}

interface Showing {
  id: number
  message: string
  hint: boolean
  from: number
  to: number
}

/**
 * Plays arrivals at their times and advances the queue at every deadline it books, which is
 * exactly what the App's frame loop does: it only acts when the clock reaches the booked time.
 */
function play(arrivals: readonly Arrival[], limits: NoticeLimits, until = 300_000) {
  let queue = createNoticeQueue()
  let due: number | null = null
  let index = 0
  let maxShown = 0
  let maxHints = 0
  const arrivedAt = new Map<number, number>()
  const open = new Map<string, Showing>()
  const showings: Showing[] = []
  const settle = (now: number) => {
    const live = new Set<string>()
    for (const notice of queue.shown) {
      const key = `${String(notice.id)}@${String(notice.shownAt)}`
      live.add(key)
      if (!open.has(key)) {
        open.set(key, { id: notice.id, message: notice.message, hint: notice.hint, from: notice.shownAt, to: Infinity })
      }
    }
    for (const [key, showing] of open) {
      if (live.has(key)) continue
      showing.to = now
      showings.push(showing)
      open.delete(key)
    }
    maxShown = Math.max(maxShown, queue.shown.length)
    maxHints = Math.max(maxHints, queue.shown.filter((notice) => notice.hint).length)
  }
  const sorted = [...arrivals].sort((first, second) => first.at - second.at)
  for (;;) {
    const arrival = sorted[index]
    const next = Math.min(arrival?.at ?? Infinity, due ?? Infinity)
    if (!Number.isFinite(next) || next > until) break
    if (arrival && arrival.at === next) {
      const id = queue.nextId
      queue = pushNotice(queue, arrival, next, limits)
      if (queue.nextId > id) arrivedAt.set(id, next)
      index += 1
    } else {
      queue = advanceNotices(queue, next, limits)
    }
    due = nextNoticeDeadline(queue, limits, next)
    settle(next)
  }
  for (const showing of open.values()) showings.push(showing)
  showings.sort((first, second) => first.from - second.from || first.id - second.id)
  const wait = (message: string) => {
    const showing = showings.find((entry) => entry.message === message)
    return showing ? showing.from - (arrivedAt.get(showing.id) ?? showing.from) : undefined
  }
  return { queue, showings, maxShown, maxHints, wait }
}

const firstShown = (showings: readonly Showing[], message: string) =>
  showings.find((showing) => showing.message === message)?.from

const info = (at: number, message: string): Arrival => ({ at, message, tone: 'info' })
const hint = (at: number, id: HintId): Arrival => ({ at, message: describeHint(id).text, tone: describeHint(id).tone, origin: 'hint' })

// ---------------------------------------------------------------------------
// Lifetimes and the hint gap
// ---------------------------------------------------------------------------

test('a notice lives longer when it says more, between the old 4.3 s and a ceiling under the hint gap', () => {
  assert.equal(noticeLifetimeMs('Мир собран.'), NOTICE_MIN_LIFETIME_MS)
  assert.equal(NOTICE_MIN_LIFETIME_MS, 4300, 'the floor is the life every notice used to have')
  const lengths = [10, 80, 130, 150, 170, 190, 400]
  const lives = lengths.map((length) => noticeLifetimeMs('ж'.repeat(length)))
  for (let index = 1; index < lives.length; index += 1) assert.ok(lives[index] >= lives[index - 1])
  assert.equal(noticeLifetimeMs('ж'.repeat(400)), NOTICE_MAX_LIFETIME_MS)
  assert.ok(NOTICE_MAX_LIFETIME_MS < HINT_MIN_GAP_SECONDS * 1000,
    'a hint must be gone before the director may release the next one')
  assert.equal(HINT_NOTICE_GAP_MS, HINT_MIN_GAP_SECONDS * 1000)
  // The longest real first-time line gets the most time, and more than it used to.
  const longest = HINT_IDS.map((id) => describeHint(id).text).sort((first, second) => second.length - first.length)[0]
  assert.ok(noticeLifetimeMs(longest) > NOTICE_MIN_LIFETIME_MS + 1000, `${String(noticeLifetimeMs(longest))} ms`)
  assert.ok(noticeLifetimeMs(longest) <= NOTICE_MAX_LIFETIME_MS)
})

test('two first-time lines never share the stack, even when the second arrives early', () => {
  const arrivals = [hint(0, 'squad'), hint(1000, 'interact')]
  const { showings, maxShown } = play(arrivals, WIDE_NOTICE_LIMITS)
  assert.equal(maxShown, 1, 'two hints were on screen together')
  assert.equal(firstShown(showings, describeHint('interact').text), HINT_NOTICE_GAP_MS, 'the second hint did not keep the gap')

  // Control: the same lines without the hint label are ordinary notices and share at once.
  const plain = play(arrivals.map(({ origin: _origin, ...rest }) => rest), WIDE_NOTICE_LIMITS)
  assert.equal(plain.maxShown, 2)
  assert.equal(firstShown(plain.showings, describeHint('interact').text), 1000)
})

test('a first-time line never waits for a notice, and a notice never waits for a line', () => {
  // A phone: one place for news, one for the lesson. Three dangers hold the news place.
  const arrivals: Arrival[] = [
    ...[0, 1, 2].map((index): Arrival => ({ at: 0, message: `Опасно ${String(index)}.`, tone: 'danger' })),
    hint(10, 'map'),
    { at: 20, message: 'Награда.', tone: 'success' },
    { at: 30, message: 'Предупреждение.', tone: 'warning' },
    info(40, 'Простая весть.'),
  ]
  const { showings, queue, maxShown, maxHints, wait } = play(arrivals, NARROW_NOTICE_LIMITS)
  assert.equal(wait(describeHint('map').text), 0, 'the hint waited behind the news')
  assert.equal(maxShown, 2)
  assert.equal(maxHints, 1)
  // News waits by urgency, however long; only plain info goes stale and is dropped.
  const shown = showings.map((showing) => showing.message)
  for (const kept of ['Награда.', 'Предупреждение.']) assert.ok(shown.includes(kept), `${kept} was dropped`)
  assert.ok((wait('Награда.') ?? 0) > NOTICE_STALE_INFO_MS, 'the reward did not have to wait past the stale age')
  assert.equal(shown.includes('Простая весть.'), false)
  assert.equal(queue.stats.dropped, 1)

  // Control: a notice in the lesson's place would have waited like the rest.
  const unlabelled = play(arrivals.map(({ origin: _origin, ...rest }) => rest), NARROW_NOTICE_LIMITS)
  assert.ok((unlabelled.wait(describeHint('map').text) ?? Infinity) > 0)
})

// ---------------------------------------------------------------------------
// Caps, staleness and the queue's own limit
// ---------------------------------------------------------------------------

test('a burst shows at most the limit at once and queues the rest instead of dropping it', () => {
  const burst = [1, 2, 3, 4, 5].map((index) => info(0, `Новость ${String(index)}.`))
  const wide = play(burst, WIDE_NOTICE_LIMITS)
  assert.equal(wide.maxShown, WIDE_NOTICE_LIMITS.notices)
  assert.equal(wide.showings.length, 5, 'a queued notice never reached the screen')
  assert.equal(firstShown(wide.showings, 'Новость 3.'), NOTICE_MIN_LIFETIME_MS)

  const narrow = play(burst, NARROW_NOTICE_LIMITS)
  assert.equal(narrow.maxShown, 1)
  // One place: the third goes up at 8.6 s, and info that waited 10 s is old news, so it goes.
  assert.deepEqual(narrow.showings.map((showing) => showing.message), ['Новость 1.', 'Новость 2.', 'Новость 3.'])
  assert.equal(narrow.queue.stats.dropped, 2)
  assert.equal(narrow.queue.waiting.length, 0)

  // Control: the old stack's limit of four shows four at once.
  assert.equal(play(burst, { notices: 4, hints: 1 }).maxShown, 4)
})

test('the waiting line is capped, and the cap never costs a hint or a danger notice', () => {
  let queue = createNoticeQueue()
  for (let index = 0; index < 20; index += 1) queue = pushNotice(queue, info(0, `Шум ${String(index)}.`), 0, NARROW_NOTICE_LIMITS)
  assert.equal(queue.shown.length, 1)
  assert.equal(queue.waiting.length, NOTICE_MAX_WAITING)
  assert.equal(queue.stats.dropped, 20 - 1 - NOTICE_MAX_WAITING)
  // The oldest of the least urgent go first, so the newest news survives.
  assert.equal(queue.waiting.at(-1)?.message, 'Шум 19.')

  // Hints arriving faster than the gap wait in line; a full line of them is never trimmed.
  let hinted = createNoticeQueue()
  for (const id of HINT_IDS.slice(0, NOTICE_MAX_WAITING + 1)) hinted = pushNotice(hinted, hint(0, id), 0, NARROW_NOTICE_LIMITS)
  assert.equal(hinted.waiting.length, NOTICE_MAX_WAITING)
  hinted = pushNotice(hinted, { message: 'Опасно.', tone: 'danger' }, 0, NARROW_NOTICE_LIMITS)
  hinted = pushNotice(hinted, { message: 'Лишняя весть.', tone: 'danger' }, 0, NARROW_NOTICE_LIMITS)
  assert.equal(hinted.waiting.length, NOTICE_MAX_WAITING + 1, 'a hint or the danger notice was dropped to make room')
  // Control: once a plain notice is in line, it is the one that goes.
  hinted = pushNotice(hinted, info(0, 'Совсем пустяк.'), 0, NARROW_NOTICE_LIMITS)
  assert.equal(hinted.waiting.some((notice) => notice.message === 'Совсем пустяк.'), false)
  assert.equal(hinted.waiting.filter((notice) => notice.hint).length, NOTICE_MAX_WAITING)
  assert.ok(hinted.waiting.some((notice) => notice.message === 'Лишняя весть.'))
})

test('a line tagged as an outcome is kept: it waits out the stale age and the cap, in the news place', () => {
  // Three dangers hold the phone's one place for news for about 15 s.
  const blockers = [0, 1, 2].map((index): Arrival => ({ at: 0, message: `Опасно ${String(index)}.`, tone: 'danger' }))
  const outcome: Arrival = { at: 10, message: 'Обоз дошёл без проводника.', tone: 'info', origin: 'outcome' }
  const kept = play([...blockers, outcome], NARROW_NOTICE_LIMITS)
  assert.ok((kept.wait(outcome.message) ?? 0) > NOTICE_STALE_INFO_MS, 'the outcome never had to wait out the stale age')
  assert.equal(kept.maxHints, 0, 'an outcome is news, not a first-time line')
  // Control: untagged, the same line goes stale behind the same dangers.
  const { origin: _origin, ...untagged } = outcome
  assert.equal(play([...blockers, untagged], NARROW_NOTICE_LIMITS).wait(outcome.message), undefined)

  // At the cap the least urgent line goes, but never a kept one, however calm its tone.
  let line = pushNotice(createNoticeQueue(), { message: 'Опасно.', tone: 'danger' }, 0, NARROW_NOTICE_LIMITS)
  line = pushNotice(line, { message: 'Обоз ушёл своим ходом без тебя и дошёл.', tone: 'success', origin: 'outcome' }, 0, NARROW_NOTICE_LIMITS)
  for (let index = 0; index < NOTICE_MAX_WAITING; index += 1) {
    line = pushNotice(line, { message: `Ватага ${String(index)}.`, tone: 'warning' }, 0, NARROW_NOTICE_LIMITS)
  }
  assert.equal(line.waiting.length, NOTICE_MAX_WAITING)
  assert.ok(line.waiting.some((notice) => notice.message === 'Обоз ушёл своим ходом без тебя и дошёл.'))
  assert.equal(line.waiting.some((notice) => notice.message === 'Ватага 0.'), false, 'the oldest warning goes instead')
  // Control: untagged, the calm success is the first line the cap cuts.
  let plain = pushNotice(createNoticeQueue(), { message: 'Опасно.', tone: 'danger' }, 0, NARROW_NOTICE_LIMITS)
  plain = pushNotice(plain, { message: 'Обоз ушёл своим ходом без тебя и дошёл.', tone: 'success' }, 0, NARROW_NOTICE_LIMITS)
  for (let index = 0; index < NOTICE_MAX_WAITING; index += 1) {
    plain = pushNotice(plain, { message: `Ватага ${String(index)}.`, tone: 'warning' }, 0, NARROW_NOTICE_LIMITS)
  }
  assert.equal(plain.waiting.some((notice) => notice.message === 'Обоз ушёл своим ходом без тебя и дошёл.'), false)
})

// ---------------------------------------------------------------------------
// Rank and preemption
// ---------------------------------------------------------------------------

test('danger, then warnings, then rewards, then info: the most urgent waiting notice goes first', () => {
  const arrivals: Arrival[] = [
    info(0, 'Сначала просто весть.'),
    { at: 100, message: 'Награда.', tone: 'success' },
    { at: 200, message: 'Осторожно.', tone: 'warning' },
    { at: 300, message: 'Рука!', tone: 'danger' },
  ]
  const { showings, queue } = play(arrivals, NARROW_NOTICE_LIMITS)
  // Danger takes the place as soon as the info has had its minimum time, and the rest follow by rank.
  assert.equal(firstShown(showings, 'Рука!'), NOTICE_MIN_DWELL_MS)
  const order = [...new Set(showings.map((showing) => showing.message))]
  assert.deepEqual(order, ['Сначала просто весть.', 'Рука!', 'Осторожно.', 'Награда.'])
  assert.equal(queue.stats.preempted, 1)
})

test('a displaced notice comes back with the time it had left, and a nearly read one retires', () => {
  const long = 'Длинная весть, которую не успели дочитать: она вернётся, когда опасность сойдёт с экрана.'
  const { showings } = play([info(0, long), { at: 2000, message: 'Опасно.', tone: 'danger' }], NARROW_NOTICE_LIMITS)
  const back = showings.filter((showing) => showing.message === long)
  assert.equal(back.length, 2, 'the displaced notice never came back')
  const total = back.reduce((sum, showing) => sum + (showing.to - showing.from), 0)
  assert.equal(total, noticeLifetimeMs(long), 'the notice lost or gained time by being displaced')
  assert.equal(back[0].to, 2000)

  // Control: displaced with less than the resume floor left, it is not shown again.
  const late = play([info(0, 'Почти дочитал.'), { at: 3500, message: 'Опасно.', tone: 'danger' }], NARROW_NOTICE_LIMITS)
  assert.equal(late.showings.filter((showing) => showing.message === 'Почти дочитал.').length, 1)
})

test('equal or lower rank never takes a place, and a minimum dwell protects a fresh notice', () => {
  const equal = play([info(0, 'Первая.'), info(500, 'Вторая.')], NARROW_NOTICE_LIMITS)
  assert.equal(firstShown(equal.showings, 'Вторая.'), NOTICE_MIN_LIFETIME_MS)
  assert.equal(equal.queue.stats.preempted, 0)

  const lower = play([{ at: 0, message: 'Опасно.', tone: 'danger' }, info(2000, 'Пустяк.')], NARROW_NOTICE_LIMITS)
  assert.equal(firstShown(lower.showings, 'Пустяк.'), NOTICE_MIN_LIFETIME_MS)

  // The booked deadline is the end of the dwell, so the frame loop wakes exactly then.
  let queue = pushNotice(createNoticeQueue(), info(0, 'Свежая.'), 0, NARROW_NOTICE_LIMITS)
  queue = pushNotice(queue, { message: 'Опасно.', tone: 'danger' }, 400, NARROW_NOTICE_LIMITS)
  assert.equal(queue.shown[0].message, 'Свежая.')
  assert.equal(nextNoticeDeadline(queue, NARROW_NOTICE_LIMITS, 400), NOTICE_MIN_DWELL_MS)
  assert.equal(advanceNotices(queue, NOTICE_MIN_DWELL_MS - 1, NARROW_NOTICE_LIMITS), queue, 'nothing is due before the dwell ends')
  assert.equal(advanceNotices(queue, NOTICE_MIN_DWELL_MS, NARROW_NOTICE_LIMITS).shown[0].message, 'Опасно.')
})

// ---------------------------------------------------------------------------
// Merging
// ---------------------------------------------------------------------------

test('a repeated notice is one line with a count, on screen or in line, and its clock restarts', () => {
  let queue = createNoticeQueue()
  for (const at of [0, 1000, 2000]) {
    queue = pushNotice(queue, { message: ABILITY_BLOCKED_NO_STAMINA_NOTICE, tone: 'warning' }, at, WIDE_NOTICE_LIMITS)
  }
  assert.equal(queue.shown.length, 1)
  assert.deepEqual(noticeViews(queue).map((notice) => notice.count), [3])
  assert.equal(queue.shown[0].expiresAt, 2000 + noticeLifetimeMs(ABILITY_BLOCKED_NO_STAMINA_NOTICE))
  assert.equal(queue.stats.merged, 2)

  let narrow = pushNotice(createNoticeQueue(), info(0, 'Занято.'), 0, NARROW_NOTICE_LIMITS)
  narrow = pushNotice(narrow, info(10, 'Повтор.'), 10, NARROW_NOTICE_LIMITS)
  narrow = pushNotice(narrow, info(20, 'Повтор.'), 20, NARROW_NOTICE_LIMITS)
  assert.equal(narrow.waiting.length, 1)
  assert.equal(narrow.waiting[0].count, 2)

  // Control: the same words in another tone are a different notice.
  const toned = pushNotice(queue, { message: ABILITY_BLOCKED_NO_STAMINA_NOTICE, tone: 'info' }, 2500, WIDE_NOTICE_LIMITS)
  assert.equal(toned.shown.length, 2)
  assert.deepEqual(noticeViews(toned).map((notice) => notice.count), [3, 1])
})

// ---------------------------------------------------------------------------
// Layout policy, the App's hooks, and one opening
// ---------------------------------------------------------------------------

test('fewer places hand back the least urgent notices with their time; more places show them again', () => {
  const roomy: NoticeLimits = { notices: 3, hints: 1 }
  let queue = createNoticeQueue()
  queue = pushNotice(queue, info(0, 'Весть.'), 0, roomy)
  queue = pushNotice(queue, { message: 'Награда.', tone: 'success' }, 100, roomy)
  queue = pushNotice(queue, { message: 'Осторожно.', tone: 'warning' }, 200, roomy)
  const narrow = advanceNotices(queue, 1000, NARROW_NOTICE_LIMITS)
  assert.deepEqual(noticeViews(narrow).map((notice) => notice.message), ['Осторожно.'])
  assert.deepEqual(narrow.waiting.map((notice) => notice.remainingMs),
    [noticeLifetimeMs('Весть.') - 1000, noticeLifetimeMs('Награда.') - 900])
  const wide = advanceNotices(narrow, 1500, roomy)
  assert.equal(wide.shown.length, 3)
  // Control: the same limits twice is a fixed point, and an empty queue books nothing.
  assert.equal(advanceNotices(wide, 1500, roomy), wide)
  assert.equal(nextNoticeDeadline(createNoticeQueue(), NARROW_NOTICE_LIMITS, 0), null)
})

test('the lane and the limits follow the layout, and the run log is opt-in', () => {
  assert.equal(noticeLaneFor('full', true), 'column')
  assert.equal(noticeLaneFor('compact', true), 'column')
  assert.equal(noticeLaneFor('compact', false), 'side')
  assert.equal(noticeLaneFor('full', false), 'screen')
  assert.deepEqual(noticeLimitsFor(true), { notices: 1, hints: 1 })
  assert.deepEqual(noticeLimitsFor(false), { notices: 2, hints: 1 })
  assert.equal(noticeLogEnabled('?noticeLog=1'), true)
  assert.equal(noticeLogEnabled('?seed=7&noticeLog=1'), true)
  assert.equal(noticeLogEnabled(''), false)
  assert.equal(noticeLogEnabled('?noticeLog=0'), false)
})

test('an opening on a phone keeps one lesson and one piece of news up, danger at once, no hint late', () => {
  const opening: Arrival[] = [
    { at: 0, message: 'Мир seed 20261006 собран.', tone: 'success' },
    hint(50, 'squad'),
    { at: 900, message: describeZoneDiscovered('forest'), tone: 'info' },
    hint(6050, 'cameraFallback'),
    { at: 7000, message: describeCaravanOfferChosen('Корован на лесной дороге', 'B2'), tone: 'info' },
    { at: 9000, message: describeEventStarted('Чужая ватага', 'Проредить.'), tone: 'warning' },
    hint(12_100, 'map'),
    { at: 13_000, message: describeLimbLost('leftArm'), tone: 'danger' },
    { at: 14_000, message: NIGHT_FALL_NOTICE, tone: 'warning' },
    hint(18_200, 'melee'),
    { at: 20_000, message: describeObjectiveCompleted('Добраться до точки «Лагерь фракции»'), tone: 'success' },
  ]
  const { showings, maxShown, maxHints, queue, wait } = play(opening, NARROW_NOTICE_LIMITS)
  assert.equal(maxShown, 2)
  assert.equal(maxHints, 1)
  assert.ok((wait(describeLimbLost('leftArm')) ?? Infinity) <= NOTICE_MIN_DWELL_MS, 'danger waited behind calmer news')
  for (const id of ['squad', 'cameraFallback', 'map', 'melee'] as const) {
    assert.equal(wait(describeHint(id).text), 0, `${id} waited`)
  }
  assert.equal(queue.waiting.length, 0, 'the opening never drained')
  for (const showing of showings) assert.ok(showing.to - showing.from <= NOTICE_MAX_LIFETIME_MS)

  // Control: the old stack of four puts more than two up at once.
  assert.ok(play(opening, { notices: 4, hints: 1 }).maxShown > 2)
})

// ---------------------------------------------------------------------------
// W3-6b — achievements and finds are notices; settings changed in a menu are not
// ---------------------------------------------------------------------------

const trophy = (name: string): NoticeArt =>
  ({ kind: 'achievement', rarity: 'rare', label: 'Достижение открыто · Редкое', title: name, detail: 'Описание.' })
const find = (title: string, detail: string): NoticeArt =>
  ({ kind: 'loot', rarity: 'common', label: 'Обычная награда', title, detail })

test('W3-6b: an achievement stays up the longest a notice may and survives the cap; untagged it does neither', () => {
  const achievement = { message: 'Достижение открыто · Редкое. Суть такова. Описание.', tone: 'success' as const }
  const up = pushNotice(createNoticeQueue(), { ...achievement, origin: 'achievement', art: trophy('Суть такова') },
    0, NARROW_NOTICE_LIMITS)
  assert.equal(up.shown[0]?.expiresAt, NOTICE_MAX_LIFETIME_MS)
  assert.deepEqual(noticeViews(up)[0]?.art, trophy('Суть такова'), 'the view carries the art to draw')
  // Control: the same short line, untagged, lives by its length.
  assert.equal(pushNotice(createNoticeQueue(), achievement, 0, NARROW_NOTICE_LIMITS).shown[0]?.expiresAt,
    noticeLifetimeMs(achievement.message))
  assert.ok(noticeLifetimeMs(achievement.message) < NOTICE_MAX_LIFETIME_MS)

  // A dense phone burst: a danger holds the place, then the achievement, then a dozen warnings.
  const burst = (origin: NoticeOrigin | undefined) => {
    let queue = pushNotice(createNoticeQueue(), { message: 'Опасно.', tone: 'danger' }, 0, NARROW_NOTICE_LIMITS)
    queue = pushNotice(queue, { ...achievement, ...(origin ? { origin } : {}) }, 10, NARROW_NOTICE_LIMITS)
    for (let index = 0; index < NOTICE_MAX_WAITING; index += 1) {
      queue = pushNotice(queue, { message: `Ватага ${String(index)}.`, tone: 'warning' }, 20, NARROW_NOTICE_LIMITS)
    }
    return queue.waiting.some((notice) => notice.message === achievement.message)
  }
  assert.equal(burst('achievement'), true, 'the cap cut an achievement')
  assert.equal(burst(undefined), false, 'control: an untagged reward is the first line the cap cuts')
})

test('W3-6b: a find flashes for the toast\'s 2.4 s, the next find takes its line, and a late one is dropped', () => {
  const loot = (title: string, detail: string) =>
    ({ message: `Обычная награда. ${title}. ${detail}`, tone: 'success' as const, origin: 'loot' as const, art: find(title, detail) })
  let queue = pushNotice(createNoticeQueue(), loot('Монеты', '+5 золота'), 0, NARROW_NOTICE_LIMITS)
  const first = queue.shown[0]
  assert.equal(first?.expiresAt, LOOT_NOTICE_LIFETIME_MS)
  // A second find replaces the first in place: the same line, the new words, a fresh clock.
  queue = pushNotice(queue, loot('Лекарство', '+20 здоровья'), 500, NARROW_NOTICE_LIMITS)
  assert.equal(queue.shown.length, 1)
  assert.equal(queue.shown[0]?.id, first?.id, 'the line moved or a second one opened')
  assert.equal(queue.shown[0]?.message, loot('Лекарство', '+20 здоровья').message)
  assert.deepEqual(queue.shown[0]?.art, find('Лекарство', '+20 здоровья'))
  assert.equal(queue.shown[0]?.count, 1)
  assert.equal(queue.shown[0]?.expiresAt, 500 + LOOT_NOTICE_LIFETIME_MS)
  // The same find again is a repeat, counted on the same line.
  queue = pushNotice(queue, loot('Лекарство', '+20 здоровья'), 800, NARROW_NOTICE_LIMITS)
  assert.equal(queue.shown[0]?.count, 2)
  assert.equal(queue.shown[0]?.expiresAt, 800 + LOOT_NOTICE_LIFETIME_MS)
  // Control: two different plain lines queue as two.
  let plain = pushNotice(createNoticeQueue(), { message: 'Весть один.', tone: 'success' }, 0, NARROW_NOTICE_LIMITS)
  plain = pushNotice(plain, { message: 'Весть два.', tone: 'success' }, 500, NARROW_NOTICE_LIMITS)
  assert.equal(plain.shown.length + plain.waiting.length, 2)

  // Behind a danger, finds wait as one line, the newest, and drop once their moment passed.
  let busy = pushNotice(createNoticeQueue(), { message: 'Опасно.', tone: 'danger' }, 3000, NARROW_NOTICE_LIMITS)
  busy = pushNotice(busy, loot('Монеты', '+5 золота'), 3100, NARROW_NOTICE_LIMITS)
  busy = pushNotice(busy, loot('Монеты', '+7 золота'), 3500, NARROW_NOTICE_LIMITS)
  busy = pushNotice(busy, { message: 'Весть.', tone: 'info' }, 3500, NARROW_NOTICE_LIMITS)
  assert.deepEqual(busy.waiting.map((notice) => notice.message), [loot('Монеты', '+7 золота').message, 'Весть.'])
  assert.equal(nextNoticeDeadline(busy, NARROW_NOTICE_LIMITS, 3500), 3500 + LOOT_NOTICE_LIFETIME_MS)
  const later = advanceNotices(busy, 3500 + LOOT_NOTICE_LIFETIME_MS, NARROW_NOTICE_LIMITS)
  assert.deepEqual(later.waiting.map((notice) => notice.message), ['Весть.'], 'the late find was not dropped')
  assert.equal(later.stats.dropped, 1)
})

test('W3-6b: a setting changed in a menu raises no notice; the HUD\'s own button mid-game still does', () => {
  assert.equal(settingNoticeWanted(true, null), true)
  for (const overlay of ['pause', 'shop', 'atlas', 'orders', 'journal', 'achievements', 'end']) {
    assert.equal(settingNoticeWanted(true, overlay), false, overlay)
  }
  assert.equal(settingNoticeWanted(false, null), false, 'the main menu shows its own state')

  // The App routes every setting's line through that rule, and only those lines.
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const handler = (name: string) => {
    const start = app.indexOf(`const ${name} = (`)
    assert.notEqual(start, -1, `Missing ${name}`)
    return app.slice(start, app.indexOf('\n  }\n', start))
  }
  assert.match(handler('announceSetting'),
    /settingNoticeWanted\(screen === 'game', topGameOverlay\(overlaysRef\.current\)\)\) addNotice\(message, 'info'\)/)
  for (const name of ['toggleMusic', 'toggleDynamicDayNight', 'toggleInkOutlines', 'toggleWeather']) {
    assert.match(handler(name), /announceSetting\(/, name)
    assert.doesNotMatch(handler(name), /addNotice\(/, `${name} bypasses the rule`)
  }
  // Control: a purchase is not a setting; its line waits for the shop to close and then shows.
  assert.match(handler('buyItem'), /addNotice\(result\.message/)
  assert.doesNotMatch(handler('buyItem'), /announceSetting/)
})

test('W3-6b: the column lane covers phones, touch screens and windows up to 1000 px', () => {
  assert.equal(COLUMN_LANE_QUERY, '(max-width: 1000px), (pointer: coarse)')
  assert.deepEqual(noticeLimitsFor(true), NARROW_NOTICE_LIMITS)
  assert.equal(noticeLaneFor('full', true), 'column')
})
