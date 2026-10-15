/* Board <-> markdown, plus natural-language task parsing (dates, times, priority, repeat, #tags, @contexts). */

export type Priority = "high" | "medium" | "low";
export interface Sub { text: string; done: boolean }
export interface Card { id: string; text: string; checked: boolean; desc: string; subs: Sub[] }
export interface Lane { id: string; title: string; cards: Card[]; limit?: number; collapsed?: boolean; extra?: string }
export interface Board { lanes: Lane[]; archive: Card[]; frontmatter?: string; preamble?: string; archiveExtra?: string }
export interface CardInfo { title: string; date?: string; time?: string; priority?: Priority; repeat?: string; tags: string[]; contexts: string[] }

let counter = 0;
export const uid = (): string => `k${Date.now().toString(36)}${(counter++).toString(36)}`;
export const newCard = (text: string, desc = "", subs: Sub[] = []): Card => ({ id: uid(), text, checked: false, desc, subs });

export const DEFAULT_FRONTMATTER = "---\nkanban-plugin: board\n---\n";
const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/* ---------- board file format ----------
---
kanban-plugin: board
---

## Doing
<!-- kanban: limit=3 collapsed=1 -->

- [ ] Buy groceries #errands @home ⏫ 📅 2026-10-11 ⏰ 15:00 🔁 every week
  Notes go on indented lines
  - [x] subtask

***

## Archive

- [x] old card
*/

export function isBoard(content: string): boolean {
	const m = FM_RE.exec(content);
	return !!m && /^kanban-plugin\s*:/m.test(m[1]);
}

export function parseBoard(content: string): Board {
	const fm = FM_RE.exec(content);
	const body = fm ? content.slice(fm[0].length) : content;
	const lanes: Lane[] = [];
	const archive: Card[] = [];
	const pre: string[] = [];
	const archExtra: string[] = [];
	const laneExtra = new Map<Lane, string[]>();
	let cur: Lane | null = null;
	let last: Card | null = null;
	let inArchive = false;

	// Anything we do not recognise is kept (never dropped) and written back on save.
	const stray = (line: string): void => {
		const bucket = cur ? (laneExtra.get(cur) as string[]) : inArchive ? archExtra : pre;
		const blank = !line.trim();
		if (blank && (!bucket.length || !bucket[bucket.length - 1].trim())) return;
		bucket.push(line);
		if (!blank) last = null;
	};

	for (const line of body.split(/\r?\n/)) {
		if (/^\*\*\*\s*$/.test(line)) { inArchive = true; cur = null; last = null; continue; }
		const h = /^##\s+(.*)$/.exec(line);
		if (h) {
			last = null;
			if (!inArchive) {
				cur = { id: uid(), title: h[1].trim(), cards: [] };
				lanes.push(cur);
				laneExtra.set(cur, []);
			}
			continue;
		}
		const meta = /^<!--\s*kanban:(.*?)-->\s*$/.exec(line.trim());
		if (meta && cur) {
			const lim = /limit=(\d+)/.exec(meta[1]);
			if (lim) cur.limit = +lim[1];
			if (/collapsed=1/.test(meta[1])) cur.collapsed = true;
			continue;
		}
		const sub = /^(?:\t| {2,})[-*]\s+\[([ xX])\]\s?(.*)$/.exec(line);
		if (sub && last) { last.subs.push({ done: sub[1] !== " ", text: sub[2].trim() }); continue; }
		const c = /^[-*]\s+\[([ xX])\]\s?(.*)$/.exec(line);
		if (c && (cur || inArchive)) {
			last = newCard(c[2].trim());
			last.checked = c[1] !== " ";
			(inArchive ? archive : cur!.cards).push(last);
			continue;
		}
		const d = /^(?:\t| {2,})(\S.*)$/.exec(line);
		if (d && last) { last.desc += (last.desc ? "\n" : "") + d[1]; continue; }
		stray(line);
	}

	const join = (a: string[]): string => {
		while (a.length && !a[a.length - 1].trim()) a.pop();
		return a.join("\n");
	};
	for (const l of lanes) {
		const t = join(laneExtra.get(l) as string[]);
		if (t) l.extra = t;
	}
	const frontmatter = fm ? (fm[0].endsWith("\n") ? fm[0] : fm[0] + "\n") : undefined;
	return { lanes, archive, frontmatter, preamble: join(pre) || undefined, archiveExtra: join(archExtra) || undefined };
}

const oneLine = (s: string): string => s.replace(/\s*\n\s*/g, " ");

function cardLines(c: Card): string {
	let out = `- [${c.checked ? "x" : " "}] ${oneLine(c.text)}\n`;
	for (const l of c.desc.split("\n")) if (l.trim()) out += `  ${l.trim()}\n`;
	for (const s of c.subs) out += `  - [${s.done ? "x" : " "}] ${oneLine(s.text)}\n`;
	return out;
}

export function serializeBoard(b: Board): string {
	let out = (b.frontmatter ?? DEFAULT_FRONTMATTER) + "\n";
	if (b.preamble) out += `${b.preamble}\n\n`;
	for (const l of b.lanes) {
		out += `## ${l.title}\n`;
		const opts = [l.limit ? `limit=${l.limit}` : "", l.collapsed ? "collapsed=1" : ""].filter(Boolean).join(" ");
		if (opts) out += `<!-- kanban: ${opts} -->\n`;
		out += "\n";
		if (l.extra) out += `${l.extra}\n\n`;
		for (const c of l.cards) out += cardLines(c);
		out += "\n";
	}
	if (b.archive.length || b.archiveExtra) {
		out += "***\n\n## Archive\n\n";
		if (b.archiveExtra) out += `${b.archiveExtra}\n\n`;
		for (const c of b.archive) out += cardLines(c);
	}
	return out.trimEnd() + "\n";
}

export function newBoardText(titles: string[]): string {
	return serializeBoard({ lanes: titles.map((t) => ({ id: uid(), title: t, cards: [] })), archive: [] });
}

/* ---------- task text ---------- */

const tidy = (s: string): string =>
	s.replace(/\s+/g, " ").trim().replace(/\s*\b(on|at|by|due)$/i, "").trim();

const pad = (n: number): string => String(n).padStart(2, "0");
export const isoDate = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayISO = (): string => isoDate(new Date());
export const parseISO = (s: string): Date => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };

const PRIO_BY_ICON: Record<string, Priority> = { "⏫": "high", "🔼": "medium", "🔽": "low" };
const PRIO_ICON: Record<Priority, string> = { high: "⏫", medium: "🔼", low: "🔽" };

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MON = "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec";

/** Pull out the stored tokens: 📅 date, ⏰ time, priority icon, 🔁 repeat. */
export function takeTokens(input: string): { text: string; date?: string; time?: string; priority?: Priority; repeat?: string } {
	let text = input;
	let date: string | undefined;
	let time: string | undefined;
	let priority: Priority | undefined;
	let repeat: string | undefined;
	const dm = /📅\s*(\d{4}-\d{2}-\d{2})/.exec(text);
	if (dm) { date = dm[1]; text = text.replace(dm[0], " "); }
	const tm = /⏰\s*(\d{1,2}:\d{2})/.exec(text);
	if (tm) { time = tm[1].padStart(5, "0"); text = text.replace(tm[0], " "); }
	const pm = /⏫|🔼|🔽/.exec(text);
	if (pm) { priority = PRIO_BY_ICON[pm[0]]; text = text.replace(pm[0], " "); }
	const rm = /🔁\s*(every [a-z0-9 ]+)/i.exec(text);
	if (rm) { repeat = rm[1].trim().toLowerCase(); text = text.replace(rm[0], " "); }
	return { text: tidy(text), date, time, priority, repeat };
}

/** Next date of a repeat rule such as "every week", "every 2 days", "every monday". */
export function nextRepeatDate(rep: string, from: Date, strict = true): Date {
	const r = rep.toLowerCase().trim();
	const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
	const m = /^every (?:(\d+) )?(day|week|month|year)s?$/.exec(r);
	if (m) {
		const n = +(m[1] || 1);
		if (m[2] === "day") d.setDate(d.getDate() + n);
		else if (m[2] === "week") d.setDate(d.getDate() + 7 * n);
		else if (m[2] === "month") d.setMonth(d.getMonth() + n);
		else d.setFullYear(d.getFullYear() + n);
		return d;
	}
	if (r === "every weekday") {
		do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
		return d;
	}
	const wd = DAYS.indexOf(r.replace("every ", ""));
	if (wd >= 0) {
		let diff = (wd - d.getDay() + 7) % 7;
		if (strict && diff === 0) diff = 7;
		d.setDate(d.getDate() + diff);
		return d;
	}
	d.setDate(d.getDate() + 1);
	return d;
}

/**
 * Find natural-language dates, times, priority ("!high") and repeats ("every monday") in the text,
 * remove them from the text and return them in stored form.
 */
export function extractSchedule(input: string, now: Date = new Date()): { text: string; date?: string; time?: string; priority?: Priority; repeat?: string } {
	const t = takeTokens(input);
	let text = ` ${t.text} `;
	let date = t.date;
	let time = t.time;
	let priority = t.priority;
	let repeat = t.repeat;

	// Match `body` as a whole word/phrase (not part of #tags or @contexts); returns its capture groups.
	const cut = (body: string): string[] | null => {
		const m = new RegExp(`(^|\\s)(?:${body})(?=[\\s,.;!?]|$)`, "i").exec(text);
		if (!m) return null;
		text = text.slice(0, m.index) + " " + text.slice(m.index + m[0].length);
		return m.slice(2).map((x) => x ?? "");
	};

	const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const add = (days: number): Date => { const d = new Date(base); d.setDate(d.getDate() + days); return d; };
	const monthDay = (name: string, day: number): Date => {
		const mi = MONTHS.findIndex((m) => m.startsWith(name.slice(0, 3).toLowerCase()));
		const d = new Date(base.getFullYear(), mi, day);
		if (d < base) d.setFullYear(d.getFullYear() + 1);
		return d;
	};

	if (!priority) {
		const g = cut("!(high|medium|med|low)");
		if (g) { const p = g[0].toLowerCase(); priority = p.startsWith("h") ? "high" : p.startsWith("l") ? "low" : "medium"; }
	}

	if (!repeat) {
		const g = cut(String.raw`(every (?:\d+ (?:day|week|month|year)s?|day|week|month|year|weekday|${DAYS.join("|")}))`);
		if (g) repeat = g[0].toLowerCase().replace(/\s+/g, " ");
	}

	if (!date) {
		let d: Date | undefined;
		let g: string[] | null;
		if ((g = cut(String.raw`(\d{4})-(\d{2})-(\d{2})`)) !== null) d = new Date(+g[0], +g[1] - 1, +g[2]);
		else if (cut("day after tomorrow") !== null) d = add(2);
		else if (cut("tomorrow|tmrw|tmr") !== null) d = add(1);
		else if (cut("today|tonight") !== null) d = add(0);
		else if ((g = cut(String.raw`in (\d+) (day|week|month)s?`)) !== null) {
			const n = +g[0];
			d = g[1].toLowerCase() === "month" ? new Date(base.getFullYear(), base.getMonth() + n, base.getDate()) : add(n * (g[1].toLowerCase() === "week" ? 7 : 1));
		}
		else if (cut("next week") !== null) d = add(7);
		else if (cut("next month") !== null) d = new Date(base.getFullYear(), base.getMonth() + 1, base.getDate());
		else if ((g = cut(`(?:(?:next|this|on) )?(${DAYS.join("|")})`)) !== null) {
			let diff = (DAYS.indexOf(g[0].toLowerCase()) - base.getDay() + 7) % 7;
			if (diff === 0) diff = 7;
			d = add(diff);
		}
		else if ((g = cut(String.raw`(${MON})\.?\s+(\d{1,2})(?:st|nd|rd|th)?`)) !== null) d = monthDay(g[0], +g[1]);
		else if ((g = cut(String.raw`(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(${MON})\.?`)) !== null) d = monthDay(g[1], +g[0]);
		if (d) date = isoDate(d);
	}

	if (!time) {
		let g: string[] | null;
		if ((g = cut(String.raw`(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)`)) !== null) {
			let h = +g[0];
			const pm = g[2].toLowerCase() === "pm";
			if (h <= 12) { if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
			time = `${pad(h % 24)}:${g[1] || "00"}`;
		} else if ((g = cut(String.raw`(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)`)) !== null) {
			// A bare "3:15" is far more likely 3:15 PM than 3:15 AM; use 24h (15:15) or 03:15 to be explicit.
			let h = +g[0];
			if (h >= 1 && h <= 7 && !g[0].startsWith("0")) h += 12;
			time = `${pad(h)}:${g[1]}`;
		} else if (cut("noon") !== null) time = "12:00";
		else if (cut("midnight") !== null) time = "00:00";
	}

	if (!date && (time || repeat)) {
		const weekday = !!repeat && DAYS.some((d) => repeat === `every ${d}`);
		date = isoDate(weekday ? nextRepeatDate(repeat as string, base, false) : base);
	}
	return { text: tidy(text), date, time, priority, repeat };
}

export function composeCard(text: string, date?: string, time?: string, priority?: Priority, repeat?: string): string {
	return `${text}${priority ? ` ${PRIO_ICON[priority]}` : ""}${date ? ` 📅 ${date}` : ""}${time ? ` ⏰ ${time}` : ""}${repeat ? ` 🔁 ${repeat}` : ""}`.trim();
}

/** Text of the next occurrence of a repeating card, or null if the card does not repeat. */
export function advanceRepeat(raw: string, now: Date = new Date()): string | null {
	const t = takeTokens(raw);
	if (!t.repeat) return null;
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	let next = nextRepeatDate(t.repeat, t.date ? parseISO(t.date) : today, true);
	if (next < today) next = nextRepeatDate(t.repeat, today, true);
	return composeCard(t.text, isoDate(next), t.time, t.priority, t.repeat);
}

const TAG_RE = /(^|\s)#([^\s#@,.;:!?()[\]]+)/g;
const CTX_RE = /(^|\s)@([^\s#@,.;:!?()[\]]+)/g;

/** Read a stored card line back into its parts. */
const infoCache = new Map<string, CardInfo>();

export function parseCard(raw: string): CardInfo {
	const hit = infoCache.get(raw);
	if (hit) return hit;
	const t = takeTokens(raw);
	const tags = Array.from(t.text.matchAll(TAG_RE), (m) => m[2]);
	const contexts = Array.from(t.text.matchAll(CTX_RE), (m) => m[2]);
	const title = t.text.replace(TAG_RE, " ").replace(CTX_RE, " ").replace(/\s+/g, " ").trim();
	const info: CardInfo = { title, date: t.date, time: t.time, priority: t.priority, repeat: t.repeat, tags, contexts };
	if (infoCache.size > 3000) infoCache.clear();
	infoCache.set(raw, info);
	return info;
}
