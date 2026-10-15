import { HoverParent, HoverPopover, Menu, Notice, TFile, TextFileView, WorkspaceLeaf, moment, normalizePath, setIcon } from "obsidian";
import type KanbanFlowPlugin from "./main";
import {
	Board, Card, CardInfo, Lane, Priority, advanceRepeat, composeCard, isoDate, logEvent, newBid, newCard, parseBoard,
	parseCard, serializeBoard, takeTokens, todayISO, uid,
} from "./parser";
import { ArchiveModal, ConfirmModal, PromptModal, ShortcutsModal, TaskData, TaskModal, TaskModalOptions, TaskPickerModal, TaskRef } from "./modals";
import { applyTagColor, formatDue, formatTime, isOverdue } from "./utils";
import { TaskDetailModal } from "./detail";
import type { KanbanSettings } from "./settings";

export const VIEW_TYPE = "kanban-flow-view";

type Drag = { kind: "card"; cardId: string } | { kind: "lane"; laneId: string };

export class KanbanView extends TextFileView implements HoverParent {
	hoverPopover: HoverPopover | null = null;
	board: Board = { lanes: [], archive: [] };
	private snap = "";
	private undoStack: string[] = [];
	private redoStack: string[] = [];
	private filterText = "";
	private quick = "";
	private mode: "board" | "calendar" = "board";
	private calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
	private calDrag: string | null = null;
	private openSubs = new Set<string>();
	private selected: string | null = null;
	private filterTimer = 0;
	private touching = false;
	private touchSince = 0;
	private suppressClick = 0;
	private drag: Drag | null = null;
	private ph: HTMLElement | null = null;
	private dragH = 0;
	private cardDrop: { laneId: string; anchorId: string | null } | null = null;
	private laneDrop = -1;

	constructor(leaf: WorkspaceLeaf, private plugin: KanbanFlowPlugin) {
		super(leaf);
	}

	getViewType(): string { return VIEW_TYPE; }
	getDisplayText(): string { return this.file?.basename ?? "Kanban"; }
	getIcon(): string { return "layout-dashboard"; }

	async onOpen(): Promise<void> {
		this.contentEl.addClass("kb-view");
		this.contentEl.tabIndex = -1;
		this.addAction("file-text", "Open as markdown", () => void this.plugin.openAsMarkdown(this.leaf));
		this.addAction("plus", "Add task", () => this.openCreate());
		this.registerDomEvent(this.contentEl, "keydown", (e: KeyboardEvent) => this.onKey(e));
	}

	getViewData(): string { return serializeBoard(this.board); }
	setViewData(data: string, clear: boolean): void {
		this.board = parseBoard(data);
		this.snap = this.getViewData();
		if (clear) { this.undoStack = []; this.redoStack = []; }
		this.render();
	}
	clear(): void { this.board = { lanes: [], archive: [] }; this.contentEl.empty(); }

	/* ------------------------------------------------------------ state, undo */

	private commit(): void {
		const now = this.getViewData();
		if (now !== this.snap) {
			this.undoStack.push(this.snap);
			if (this.undoStack.length > 50) this.undoStack.shift();
			this.redoStack = [];
			this.snap = now;
		}
		this.requestSave();
		this.render();
	}

	undo(): void {
		const prev = this.undoStack.pop();
		if (prev === undefined) { new Notice("Nothing to undo."); return; }
		this.redoStack.push(this.snap);
		this.restore(prev);
	}

	redo(): void {
		const next = this.redoStack.pop();
		if (next === undefined) { new Notice("Nothing to redo."); return; }
		this.undoStack.push(this.snap);
		this.restore(next);
	}

	private restore(text: string): void {
		this.snap = text;
		this.board = parseBoard(text);
		this.requestSave();
		this.render();
	}

	private isDone(lane: Lane): boolean {
		return lane.title.trim().toLowerCase() === this.plugin.settings.doneList.trim().toLowerCase();
	}

	private collect(): { tags: string[]; contexts: string[] } {
		const tags = new Set<string>();
		const contexts = new Set<string>();
		const all = [...this.board.lanes.flatMap((l) => l.cards), ...this.board.archive];
		for (const c of all) {
			const i = parseCard(c.text);
			i.tags.forEach((t) => tags.add(t));
			i.contexts.forEach((x) => contexts.add(x));
		}
		return { tags: Array.from(tags).sort(), contexts: Array.from(contexts).sort() };
	}

	/* ------------------------------------------------------------ filtering */

	private get filtering(): boolean { return !!(this.filterText.trim() || this.quick); }

	private matches(card: Card, lane: Lane): boolean {
		const q = `${this.filterText} ${this.quick}`.trim().toLowerCase();
		if (!q) return true;
		const info = parseCard(card.text);
		const done = this.isDone(lane);
		const hay = `${info.title} ${card.desc}`.toLowerCase();
		for (const tok of q.split(/\s+/)) {
			if (tok.startsWith("#")) { if (!info.tags.some((t) => t.toLowerCase().startsWith(tok.slice(1)))) return false; }
			else if (tok.startsWith("@")) { if (!info.contexts.some((t) => t.toLowerCase().startsWith(tok.slice(1)))) return false; }
			else if (tok.startsWith("prio:")) { if (info.priority !== tok.slice(5)) return false; }
			else if (tok.startsWith("due:")) {
				const v = tok.slice(4);
				const today = todayISO();
				const weekEnd = v === "week" ? moment().add(6, "days").format("YYYY-MM-DD") : "";
				if (v === "overdue" && (done || !isOverdue(info))) return false;
				if (v === "today" && info.date !== today) return false;
				if (v === "week" && !(info.date && info.date >= today && info.date <= weekEnd)) return false;
				if (v === "none" && info.date) return false;
			}
			else if (!hay.includes(tok)) return false;
		}
		return true;
	}

	/* ------------------------------------------------------------ render */

	render(): void {
		const s = this.plugin.settings;
		const oldBoard = this.contentEl.querySelector<HTMLElement>(".kb-board");
		const left = oldBoard?.scrollLeft ?? 0;
		const tops = new Map<string, number>();
		this.contentEl.querySelectorAll<HTMLElement>(".kb-lane").forEach((l) =>
			tops.set(l.dataset.id ?? "", l.querySelector<HTMLElement>(".kb-cards")?.scrollTop ?? 0));
		const prevFilter = this.contentEl.querySelector<HTMLInputElement>(".kb-filter");
		const refocus = !!prevFilter && prevFilter === this.contentEl.ownerDocument.activeElement;
		const caret = prevFilter?.selectionStart ?? 0;
		this.contentEl.empty();

		const filterEl = this.renderToolbar();
		if (refocus) { filterEl.focus(); filterEl.setSelectionRange(caret, caret); }

		if (this.mode === "calendar") { this.renderCalendar(); this.restoreFocus(); return; }

		const board = this.contentEl.createDiv("kb-board");
		board.style.setProperty("--kb-lane-width", `${s.laneWidth}px`);
		for (const lane of this.board.lanes) this.renderLane(board, lane, tops.get(lane.id) ?? 0);
		if (!this.board.lanes.length) board.createDiv({ cls: "kb-hint", text: "No lists yet. Click “+ Add list” to start." });
		this.setupLaneDnd(board);
		board.scrollLeft = left;
		this.restoreFocus();
	}

	private setIconOrText(el: HTMLElement, name: string, fallback: string): void {
		setIcon(el, name);
		if (!el.querySelector("svg")) el.setText(fallback);
	}

	private iconBtn(parent: HTMLElement, name: string, label: string, fallback: string, cls: string[] = ["kb-btn"]): HTMLButtonElement {
		const b = parent.createEl("button", { cls, attr: { "aria-label": label, title: label } });
		this.setIconOrText(b, name, fallback);
		return b;
	}

	private renderToolbar(): HTMLInputElement {
		const { tags, contexts } = this.collect();
		if (this.quick.startsWith("#") && !tags.some((t) => `#${t.toLowerCase()}` === this.quick)) this.quick = "";
		if (this.quick.startsWith("@") && !contexts.some((c) => `@${c.toLowerCase()}` === this.quick)) this.quick = "";

		const bar = this.contentEl.createDiv("kb-toolbar");

		// one search bar: icon, text, clear, quick filters
		const search = bar.createDiv("kb-search");
		this.setIconOrText(search.createSpan("kb-search-icon"), "search", "⌕");
		const filter = search.createEl("input", { type: "text", cls: "kb-filter", attr: { placeholder: "Filter tasks", "aria-label": "Filter tasks" } });
		filter.value = this.filterText;
		filter.oninput = () => {
			this.filterText = filter.value;
			window.clearTimeout(this.filterTimer);
			this.filterTimer = window.setTimeout(() => this.render(), 150);
		};
		if (this.filterText) {
			const clr = search.createSpan({ cls: ["kb-icon-btn", "kb-search-clear"], text: "×", attr: { "aria-label": "Clear filter" } });
			clr.onclick = () => { this.filterText = ""; this.render(); };
		}
		const q = this.iconBtn(search, "filter", "Quick filters", "Filter", this.quick ? ["kb-btn", "is-active"] : ["kb-btn"]);
		q.onclick = (e) => this.quickMenu(e, tags, contexts);

		const actions = bar.createDiv("kb-actions");
		const seg = actions.createDiv("kb-seg");
		const modes: ["board" | "calendar", string, string, string][] = [
			["board", "layout-dashboard", "Board", "▤"],
			["calendar", "calendar", "Calendar", "▦"],
		];
		for (const [m, ic, label, fb] of modes) {
			const b = this.iconBtn(seg, ic, label, fb, this.mode === m ? ["kb-btn", "is-active"] : ["kb-btn"]);
			b.onclick = () => { this.mode = m; this.render(); };
		}

		const undoBtn = this.iconBtn(actions, "undo-2", "Undo", "↶");
		undoBtn.disabled = !this.undoStack.length;
		undoBtn.onclick = () => this.undo();

		if (this.board.archive.length) {
			const arch = this.iconBtn(actions, "archive", "Archive", "Archive");
			arch.createSpan({ cls: "kb-badge", text: String(this.board.archive.length) });
			arch.onclick = () => this.openArchive();
		}

		const addList = this.iconBtn(actions, "list-plus", "Add list", "+ List");
		addList.onclick = () => this.openAddList();

		const addTask = this.iconBtn(actions, "plus", "Add task", "+", ["kb-btn", "kb-primary"]);
		addTask.createSpan({ cls: "kb-btn-label", text: "New task" });
		addTask.onclick = () => this.openCreate();
		return filter;
	}

	private quickMenu(e: MouseEvent, tags: string[], contexts: string[]): void {
		const menu = new Menu();
		const item = (value: string, label: string): void => {
			menu.addItem((i) => i.setTitle(label).setChecked(this.quick === value).onClick(() => { this.quick = value; this.render(); }));
		};
		item("", "All tasks");
		item("due:overdue", "Overdue");
		item("due:today", "Due today");
		item("due:week", "Due this week");
		item("prio:high", "High priority");
		if (tags.length) { menu.addSeparator(); tags.forEach((t) => item(`#${t.toLowerCase()}`, `#${t}`)); }
		if (contexts.length) { menu.addSeparator(); contexts.forEach((c) => item(`@${c.toLowerCase()}`, `@${c}`)); }
		menu.showAtMouseEvent(e);
	}

	private renderLane(board: HTMLElement, lane: Lane, scrollTop: number): void {
		const total = lane.cards.length;
		const shown = lane.cards.filter((c) => this.matches(c, lane));
		const over = !!lane.limit && total > lane.limit;

		const laneEl = board.createDiv("kb-lane");
		laneEl.dataset.id = lane.id;
		if (lane.collapsed) laneEl.addClass("is-collapsed");
		if (over) laneEl.addClass("is-over-limit");

		const head = laneEl.createDiv("kb-lane-header");
		head.draggable = true;
		head.createSpan({ cls: "kb-grip", text: "⋮⋮" });
		const title = head.createSpan({ cls: "kb-lane-title", text: lane.title });
		const countText = lane.limit ? `${total}/${lane.limit}` : this.filtering ? `${shown.length}/${total}` : String(total);
		head.createSpan({ cls: over ? ["kb-count", "is-over"] : ["kb-count"], text: countText });
		const menuBtn = head.createSpan({ cls: "kb-icon-btn", text: "⋯", attr: { "aria-label": "List options" } });
		menuBtn.onclick = (e) => { e.stopPropagation(); this.laneMenu(lane, e); };

		head.addEventListener("dragstart", (e) => {
			this.drag = { kind: "lane", laneId: lane.id };
			this.dragH = laneEl.offsetHeight;
			if (e.dataTransfer) {
				e.dataTransfer.setData("text/plain", lane.title);
				e.dataTransfer.effectAllowed = "move";
				e.dataTransfer.setDragImage(laneEl, 20, 16);
			}
			window.setTimeout(() => laneEl.addClass("is-dragging"), 0);
		});
		head.addEventListener("dragend", () => this.endDrag());
		this.touchDrag(head, {
			start: () => { this.drag = { kind: "lane", laneId: lane.id }; this.dragH = laneEl.offsetHeight; laneEl.addClass("is-dragging"); laneEl.addClass("is-touch"); },
			move: (x) => { const b = this.contentEl.querySelector<HTMLElement>(".kb-board"); if (b) this.hoverLane(b, x); },
			drop: () => {
				if (this.drag?.kind !== "lane") return;
				const { laneId } = this.drag;
				const idx = this.laneDrop;
				this.endDrag();
				if (idx >= 0) this.moveLane(laneId, idx);
			},
		});

		if (lane.collapsed) {
			title.onclick = () => this.setCollapsed(lane, false);
			return;
		}
		title.ondblclick = () => this.renameLane(lane, title, head);

		const cardsEl = laneEl.createDiv("kb-cards");
		for (const card of shown) this.renderCard(cardsEl, lane, card);
		const add = laneEl.createDiv({ cls: "kb-add-card", text: "+ Add task" });
		add.onclick = () => this.openCreate(lane.id);

		laneEl.addEventListener("dragover", (e) => {
			if (this.drag?.kind !== "card") return;
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
			this.hoverCard(laneEl, lane.id, e.clientY);
		});
		laneEl.addEventListener("drop", (e) => {
			if (this.drag?.kind !== "card" || !this.cardDrop) return;
			e.preventDefault();
			e.stopPropagation();
			const { cardId } = this.drag;
			const at = this.cardDrop;
			this.endDrag();
			this.moveCard(cardId, at.laneId, at.anchorId);
		});

		cardsEl.scrollTop = scrollTop;
	}

	private renderCard(parent: HTMLElement, lane: Lane, card: Card): void {
		const s = this.plugin.settings;
		const info = parseCard(card.text);
		const done = this.isDone(lane);
		const el = parent.createDiv("kb-card");
		el.dataset.id = card.id;
		el.draggable = true;
		if (info.priority) el.addClass(`kb-prio-${info.priority}`);
		if (done) el.addClass("is-done");
		if (this.selected === card.id) el.addClass("is-selected");

		const top = el.createDiv("kb-card-top");
		const titleEl = top.createDiv("kb-card-title");
		if (info.title) this.renderInline(titleEl, info.title);
		else titleEl.createSpan({ cls: "kb-hint", text: "Untitled" });
		const menuBtn = top.createSpan({ cls: "kb-icon-btn", text: "⋯", attr: { "aria-label": "Task options" } });
		menuBtn.onclick = (e) => { e.stopPropagation(); this.cardMenu(lane, card, e); };

		if (card.desc) {
			const d = el.createDiv("kb-card-desc");
			this.renderInline(d, card.desc.replace(/\s*\n\s*/g, " "));
		}
		if (card.subs.length) {
			const doneN = card.subs.filter((x) => x.done).length;
			const prog = el.createDiv("kb-progress");
			const bar = prog.createDiv("kb-progress-bar");
			bar.createDiv("kb-progress-fill").style.width = `${Math.round((doneN / card.subs.length) * 100)}%`;
			prog.createSpan({ cls: "kb-progress-label", text: `${doneN}/${card.subs.length}` });
			const open = this.openSubs.has(card.id);
			const toggle = prog.createSpan({
				cls: ["kb-icon-btn", "kb-sub-toggle"],
				attr: { "aria-label": open ? "Hide subtasks" : "Show subtasks" },
			});
			this.setIconOrText(toggle, open ? "chevron-up" : "chevron-down", open ? "▴" : "▾");
			toggle.onclick = (e) => {
				e.stopPropagation();
				if (open) this.openSubs.delete(card.id); else this.openSubs.add(card.id);
				this.render();
			};
			if (open) {
				const list = el.createDiv("kb-subs-list");
				for (const sub of card.subs) {
					const item = list.createEl("label", { cls: sub.done ? ["kb-sub-item", "is-done"] : ["kb-sub-item"] });
					const cb = item.createEl("input", { type: "checkbox" });
					cb.checked = sub.done;
					cb.onchange = () => { sub.done = cb.checked; this.commit(); };
					this.renderInline(item.createSpan({ cls: "kb-sub-text" }), sub.text);
				}
			}
		}

		const showDue = s.showDate && !!info.date;
		const showTags = s.showTags && info.tags.length > 0;
		const showCtx = s.showContext && info.contexts.length > 0;
		if (showDue || showTags || showCtx || info.repeat) {
			const meta = el.createDiv("kb-card-meta");
			if (showDue && info.date) {
				const overdue = !done && isOverdue(info);
				const row = meta.createDiv("kb-meta-row");
				row.createSpan({ cls: "kb-meta-label", text: "due:" });
				const cls = ["kb-meta-value"];
				if (overdue) cls.push("is-overdue");
				else if (!done && info.date === todayISO()) cls.push("is-today");
				row.createSpan({ cls, text: formatDue(info.date, info.time, s) + (overdue ? " (overdue)" : "") });
			}
			if (info.repeat) {
				const row = meta.createDiv("kb-meta-row");
				row.createSpan({ cls: "kb-meta-label", text: "repeat:" });
				row.createSpan({ cls: "kb-meta-value", text: info.repeat.replace(/^every /, "every ") });
			}
			if (showTags) {
				const row = meta.createDiv("kb-meta-row");
				row.createSpan({ cls: "kb-meta-label", text: "tags:" });
				info.tags.forEach((t) => applyTagColor(row.createSpan({ cls: "kb-tag", text: t }), t, s));
			}
			if (showCtx) {
				const row = meta.createDiv("kb-meta-row");
				row.createSpan({ cls: "kb-meta-label", text: "context:" });
				info.contexts.forEach((c) => row.createSpan({ cls: "kb-context", text: c }));
			}
		}

		el.addEventListener("click", (e) => {
			if (Date.now() < this.suppressClick) return;
			if ((e.target as HTMLElement).closest("a, input, label, .kb-icon-btn, .kb-subs-list")) return;
			this.select(card.id, false);
			this.openCard(lane, card);
		});
		el.addEventListener("contextmenu", (e) => {
			e.preventDefault();
			if (this.touching || Date.now() - this.touchSince < 1500) return;
			this.cardMenu(lane, card, e);
		});

		el.addEventListener("dragstart", (e) => {
			e.stopPropagation();
			this.drag = { kind: "card", cardId: card.id };
			this.dragH = el.offsetHeight;
			if (e.dataTransfer) { e.dataTransfer.setData("text/plain", card.text); e.dataTransfer.effectAllowed = "move"; }
			window.setTimeout(() => el.addClass("is-dragging"), 0);
		});
		el.addEventListener("dragend", () => this.endDrag());
		this.touchDrag(el, {
			start: () => { this.drag = { kind: "card", cardId: card.id }; this.dragH = el.offsetHeight; el.addClass("is-dragging"); el.addClass("is-touch"); },
			move: (x, y) => { const laneEl = this.laneAt(x, y); if (laneEl) this.hoverCard(laneEl, laneEl.dataset.id ?? "", y); },
			drop: () => {
				if (this.drag?.kind !== "card" || !this.cardDrop) return;
				const { cardId } = this.drag;
				const at = this.cardDrop;
				this.endDrag();
				this.moveCard(cardId, at.laneId, at.anchorId);
			},
		});
	}

	/** Titles can contain [[wikilinks]], [text](url) and bare URLs. */
	private renderInline(el: HTMLElement, text: string): void {
		const re = /(\[\[[^\]]+\]\]|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/[^\s)]+)/g;
		let last = 0;
		let m: RegExpExecArray | null;
		while ((m = re.exec(text)) !== null) {
			if (m.index > last) el.appendText(text.slice(last, m.index));
			const tok = m[0];
			if (tok.startsWith("[[")) {
				const [target, alias] = tok.slice(2, -2).split("|");
				const a = el.createEl("a", { cls: ["internal-link", "kb-link"], text: alias || target });
				a.addEventListener("mouseover", (e) => {
					this.app.workspace.trigger("hover-link", {
						event: e,
						source: VIEW_TYPE,
						hoverParent: this,
						targetEl: a,
						linktext: target,
						sourcePath: this.file?.path ?? "",
					});
				});
				const task = /^(.*)#\^([A-Za-z0-9-]+)$/.exec(target);
				a.onclick = (e) => {
					e.preventDefault();
					e.stopPropagation();
					if (task) { void this.plugin.openTaskLink(task[1], task[2], this.file?.path ?? ""); return; }
					void this.app.workspace.openLinkText(target, this.file?.path ?? "", this.plugin.settings.openLinksInNewTab);
				};
			} else {
				const md = /^\[([^\]]+)\]\((.*)\)$/.exec(tok);
				const href = md ? md[2] : tok;
				const a = el.createEl("a", { cls: "external-link", text: md ? md[1] : tok, attr: { href } });
				a.onclick = (e) => { e.preventDefault(); e.stopPropagation(); window.open(href); };
			}
			last = m.index + tok.length;
		}
		el.appendText(text.slice(last));
	}

	/* ------------------------------------------------------------ calendar */

	private renderCalendar(): void {
		const s = this.plugin.settings;
		const cal = this.contentEl.createDiv("kb-cal");
		const y = this.calMonth.getFullYear();
		const mo = this.calMonth.getMonth();

		const head = cal.createDiv("kb-cal-head");
		const prev = head.createEl("button", { text: "‹", attr: { "aria-label": "Previous month" } });
		prev.onclick = () => { this.calMonth = new Date(y, mo - 1, 1); this.render(); };
		head.createDiv({ cls: "kb-cal-title", text: moment(this.calMonth).format("MMMM YYYY") });
		const next = head.createEl("button", { text: "›", attr: { "aria-label": "Next month" } });
		next.onclick = () => { this.calMonth = new Date(y, mo + 1, 1); this.render(); };
		const todayBtn = head.createEl("button", { text: "Today" });
		todayBtn.onclick = () => { const n = new Date(); this.calMonth = new Date(n.getFullYear(), n.getMonth(), 1); this.render(); };

		const byDate = new Map<string, { lane: Lane; card: Card; info: CardInfo }[]>();
		const undated: { lane: Lane; card: Card; info: CardInfo }[] = [];
		for (const lane of this.board.lanes) {
			for (const card of lane.cards) {
				if (!this.matches(card, lane)) continue;
				const info = parseCard(card.text);
				if (!info.date) { if (!this.isDone(lane)) undated.push({ lane, card, info }); continue; }
				const list = byDate.get(info.date) ?? [];
				list.push({ lane, card, info });
				byDate.set(info.date, list);
			}
		}
		byDate.forEach((list) => list.sort((a, b) => (a.info.time ?? "99:99").localeCompare(b.info.time ?? "99:99")));

		const startIdx = s.weekStart === "monday" ? 1 : 0;
		const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
		const grid = cal.createDiv("kb-cal-grid");
		for (let i = 0; i < 7; i++) grid.createDiv({ cls: "kb-cal-dow", text: names[(startIdx + i) % 7] });

		const first = new Date(y, mo, 1);
		const offset = (first.getDay() - startIdx + 7) % 7;
		const days = new Date(y, mo + 1, 0).getDate();
		const rows = Math.ceil((offset + days) / 7);
		const today = todayISO();

		const makeItem = (parent: HTMLElement, e: { lane: Lane; card: Card; info: CardInfo }): void => {
			const cls = ["kb-cal-item"];
			if (e.info.priority) cls.push(`kb-prio-${e.info.priority}`);
			if (this.isDone(e.lane)) cls.push("is-done");
			const item = parent.createDiv({ cls });
			item.draggable = true;
			item.setText(`${e.info.time ? formatTime(e.info.time, s) + " " : ""}${e.info.title || "Untitled"}`);
			item.onclick = () => { if (Date.now() >= this.suppressClick) this.openEdit(e.lane, e.card); };
			item.addEventListener("contextmenu", (ev) => {
				ev.preventDefault();
				if (this.touching || Date.now() - this.touchSince < 1500) return;
				this.cardMenu(e.lane, e.card, ev);
			});
			this.touchDrag(item, {
				start: () => { this.calDrag = e.card.id; item.addClass("is-dragging"); },
				move: (x, y) => {
					this.contentEl.querySelectorAll(".kb-cal-cell.is-over").forEach((n) => n.removeClass("is-over"));
					this.cellAt(x, y)?.addClass("is-over");
				},
				drop: (x, y) => {
					const id = this.calDrag;
					const date = this.cellAt(x, y)?.dataset.date;
					this.calDrag = null;
					if (id && date) this.setDate(id, date);
				},
			});
			item.addEventListener("dragstart", () => { this.calDrag = e.card.id; });
			item.addEventListener("dragend", () => { this.calDrag = null; });
		};

		for (let i = 0; i < rows * 7; i++) {
			const d = new Date(y, mo, 1 - offset + i);
			const iso = isoDate(d);
			const cls = ["kb-cal-cell"];
			if (d.getMonth() !== mo) cls.push("is-other");
			if (iso === today) cls.push("is-today");
			const cell = grid.createDiv({ cls });
			cell.dataset.date = iso;
			cell.createDiv({ cls: "kb-cal-num", text: String(d.getDate()) });
			(byDate.get(iso) ?? []).forEach((e) => makeItem(cell, e));
			cell.addEventListener("dragover", (ev) => { if (this.calDrag) { ev.preventDefault(); cell.addClass("is-over"); } });
			cell.addEventListener("dragleave", () => cell.removeClass("is-over"));
			cell.addEventListener("drop", (ev) => {
				if (!this.calDrag) return;
				ev.preventDefault();
				const id = this.calDrag;
				this.calDrag = null;
				this.setDate(id, iso);
			});
		}

		if (undated.length) {
			const box = cal.createDiv("kb-cal-undated");
			box.createDiv({ cls: "kb-meta-label", text: `No date (${undated.length}), drag onto a day to schedule` });
			const row = box.createDiv("kb-cal-undated-row");
			undated.forEach((e) => makeItem(row, e));
		}
	}

	private setDate(cardId: string, iso: string): void {
		for (const l of this.board.lanes) {
			const c = l.cards.find((x) => x.id === cardId);
			if (!c) continue;
			const t = takeTokens(c.text);
			c.text = composeCard(t.text, iso, t.time, t.priority, t.repeat);
			this.commit();
			return;
		}
	}

	/* ------------------------------------------------------------ drag & drop */

	private placeholder(cls: "kb-placeholder" | "kb-lane-placeholder"): HTMLElement {
		if (!this.ph || !this.ph.hasClass(cls)) {
			this.ph?.remove();
			this.ph = createDiv(cls);
		}
		this.ph.style.height = `${this.dragH}px`;
		return this.ph;
	}

	private endDrag(): void {
		this.ph?.remove();
		this.ph = null;
		this.drag = null;
		this.cardDrop = null;
		this.laneDrop = -1;
		this.contentEl.querySelectorAll(".is-dragging").forEach((e) => { e.removeClass("is-dragging"); e.removeClass("is-touch"); });
	}

	private setupLaneDnd(board: HTMLElement): void {
		board.addEventListener("dragover", (e) => {
			if (this.drag?.kind !== "lane") return;
			e.preventDefault();
			this.hoverLane(board, e.clientX);
		});
		board.addEventListener("drop", (e) => {
			if (this.drag?.kind !== "lane") return;
			e.preventDefault();
			const { laneId } = this.drag;
			const idx = this.laneDrop;
			this.endDrag();
			if (idx >= 0) this.moveLane(laneId, idx);
		});
	}

	private hoverCard(laneEl: HTMLElement, laneId: string, clientY: number): void {
		const cardsEl = laneEl.querySelector<HTMLElement>(":scope > .kb-cards");
		if (!cardsEl) return;
		const els = Array.from(cardsEl.querySelectorAll<HTMLElement>(":scope > .kb-card:not(.is-dragging)"));
		let idx = els.findIndex((el) => {
			const r = el.getBoundingClientRect();
			return clientY < r.top + r.height / 2;
		});
		if (idx < 0) idx = els.length;
		cardsEl.insertBefore(this.placeholder("kb-placeholder"), els[idx] ?? null);
		this.cardDrop = { laneId, anchorId: els[idx]?.dataset.id ?? null };
	}

	private hoverLane(board: HTMLElement, clientX: number): void {
		const els = Array.from(board.querySelectorAll<HTMLElement>(":scope > .kb-lane:not(.is-dragging)"));
		let idx = els.findIndex((el) => {
			const r = el.getBoundingClientRect();
			return clientX < r.left + r.width / 2;
		});
		if (idx < 0) idx = els.length;
		board.insertBefore(this.placeholder("kb-lane-placeholder"), els[idx] ?? null);
		this.laneDrop = idx;
	}

	private laneAt(x: number, y: number): HTMLElement | null {
		return this.contentEl.ownerDocument.elementFromPoint(x, y)?.closest<HTMLElement>(".kb-lane:not(.is-collapsed)") ?? null;
	}

	private cellAt(x: number, y: number): HTMLElement | null {
		return this.contentEl.ownerDocument.elementFromPoint(x, y)?.closest<HTMLElement>(".kb-cal-cell") ?? null;
	}

	private autoScroll(x: number, y: number): void {
		const edge = 48;
		const board = this.contentEl.querySelector<HTMLElement>(".kb-board");
		if (board) {
			const r = board.getBoundingClientRect();
			if (x < r.left + edge) board.scrollLeft -= 14;
			else if (x > r.right - edge) board.scrollLeft += 14;
		}
		const vertical = (el: HTMLElement | null | undefined): void => {
			if (!el) return;
			const r = el.getBoundingClientRect();
			if (y < r.top + edge) el.scrollTop -= 12;
			else if (y > r.bottom - edge) el.scrollTop += 12;
		};
		vertical(this.laneAt(x, y)?.querySelector<HTMLElement>(":scope > .kb-cards"));
		vertical(this.contentEl.querySelector<HTMLElement>(".kb-cal"));
	}

	/**
	 * Touch / pen drag: press and hold for ~0.3s, then drag. Moving earlier just scrolls.
	 * (Mouse keeps using the browser's native drag and drop.)
	 */
	private touchDrag(el: HTMLElement, cb: { start: () => void; move: (x: number, y: number) => void; drop: (x: number, y: number) => void }): void {
		el.addEventListener("touchmove", (ev) => { if (this.touching) ev.preventDefault(); }, { passive: false });
		el.addEventListener("pointerdown", (e: PointerEvent) => {
			const target = e.target as HTMLElement;
			if (target.closest("input, textarea, select")) return;
			el.draggable = e.pointerType === "mouse";
			if (e.pointerType === "mouse") return;
			if (target.closest("a, label, .kb-icon-btn")) return;

			this.touchSince = Date.now();
			const doc = el.ownerDocument;
			const sx = e.clientX;
			const sy = e.clientY;
			let x = sx;
			let y = sy;
			let active = false;
			let ghost: HTMLElement | null = null;
			let offX = 0;
			let offY = 0;
			let auto = 0;

			const place = (): void => {
				if (!ghost) return;
				ghost.style.left = `${x - offX}px`;
				ghost.style.top = `${y - offY}px`;
			};
			const cleanup = (): void => {
				window.clearTimeout(timer);
				window.clearInterval(auto);
				doc.removeEventListener("pointermove", onMove, true);
				doc.removeEventListener("pointerup", onUp, true);
				doc.removeEventListener("pointercancel", cleanup, true);
				ghost?.remove();
				if (active) {
					active = false;
					this.touching = false;
					this.endDrag();
					this.calDrag = null;
					this.contentEl.querySelectorAll(".is-over").forEach((n) => n.removeClass("is-over"));
				}
			};
			const onMove = (ev: PointerEvent): void => {
				x = ev.clientX;
				y = ev.clientY;
				if (!active) { if (Math.hypot(x - sx, y - sy) > 10) cleanup(); return; }
				ev.preventDefault();
				place();
				cb.move(x, y);
			};
			const onUp = (): void => {
				if (active) { cb.drop(x, y); this.suppressClick = Date.now() + 500; }
				cleanup();
			};
			const timer = window.setTimeout(() => {
				active = true;
				this.touching = true;
				navigator.vibrate?.(15);
				const r = el.getBoundingClientRect();
				offX = sx - r.left;
				offY = sy - r.top;
				ghost = el.cloneNode(true) as HTMLElement;
				ghost.removeAttribute("draggable");
				ghost.addClass("kb-ghost");
				ghost.style.width = `${r.width}px`;
				doc.body.appendChild(ghost);
				place();
				cb.start();
				auto = window.setInterval(() => { this.autoScroll(x, y); cb.move(x, y); }, 50);
			}, 300);
			doc.addEventListener("pointermove", onMove, true);
			doc.addEventListener("pointerup", onUp, true);
			doc.addEventListener("pointercancel", cleanup, true);
		});
	}

	private moveCard(cardId: string, toLaneId: string, anchorId: string | null): void {
		let moved: Card | undefined;
		let from: Lane | undefined;
		for (const l of this.board.lanes) {
			const i = l.cards.findIndex((c) => c.id === cardId);
			if (i >= 0) { moved = l.cards.splice(i, 1)[0]; from = l; break; }
		}
		const to = this.board.lanes.find((l) => l.id === toLaneId);
		if (!moved || !to) { this.render(); return; }
		const idx = anchorId ? to.cards.findIndex((c) => c.id === anchorId) : -1;
		to.cards.splice(idx < 0 ? to.cards.length : idx, 0, moved);
		if (from !== to) {
			logEvent(moved, "moved", from?.title, to.title);
			this.handleRecurrence(to, moved);
		}
		this.commit();
	}

	private moveLane(laneId: string, index: number): void {
		const i = this.board.lanes.findIndex((l) => l.id === laneId);
		if (i < 0) return;
		const [lane] = this.board.lanes.splice(i, 1);
		this.board.lanes.splice(index, 0, lane);
		this.commit();
	}

	/** A repeating card that reaches the done list schedules its next occurrence. */
	private handleRecurrence(lane: Lane, card: Card): void {
		if (!this.isDone(lane)) return;
		const next = advanceRepeat(card.text);
		if (!next) return;
		const target = this.board.lanes.find((l) => !this.isDone(l));
		if (!target) return;
		const fresh = newCard(next, card.desc, card.subs.map((s) => ({ text: s.text, done: false })));
		logEvent(fresh, "created", undefined, target.title);
		target.cards.push(fresh);
		const t = takeTokens(card.text);
		card.text = composeCard(t.text, t.date, t.time, t.priority);
		new Notice(`Next occurrence added to ${target.title}: ${takeTokens(next).date}`);
	}

	/* ------------------------------------------------------------ tasks */

	private modalBase(): Pick<TaskModalOptions, "lanes" | "sourcePath" | "tags" | "contexts" | "templates" | "onSaveTemplate" | "onPickTask"> {
		const { tags, contexts } = this.collect();
		return {
			lanes: this.board.lanes.map((l) => ({ id: l.id, title: l.title })),
			sourcePath: this.file?.path ?? "",
			tags,
			contexts,
			onPickTask: (insert) => void this.openTaskPicker(insert),
			templates: this.plugin.settings.templates,
			onSaveTemplate: (t) => {
				this.plugin.settings.templates.push({ id: uid(), ...t });
				void this.plugin.saveData(this.plugin.settings);
			},
		};
	}

	openCreate(laneId?: string): void {
		if (!this.board.lanes.length) { new Notice("Add a list first."); return; }
		new TaskModal(this.app, {
			...this.modalBase(),
			heading: "Create task",
			submitLabel: "Save",
			laneId: laneId ?? this.board.lanes[0].id,
			text: "",
			desc: "",
			subs: [],
			onSubmit: (d: TaskData) => {
				const lane = this.board.lanes.find((l) => l.id === d.laneId);
				if (!lane) return;
				const card = newCard(d.text, d.desc, d.subs);
				logEvent(card, "created", undefined, lane.title);
				if (this.plugin.settings.newCardPosition === "top") lane.cards.unshift(card);
				else lane.cards.push(card);
				this.commit();
			},
		}).open();
	}

	private openCard(lane: Lane, card: Card): void {
		if (this.plugin.settings.cardClick === "edit") this.openEdit(lane, card);
		else this.openDetail(lane, card);
	}

	private openDetail(lane: Lane, card: Card): void {
		new TaskDetailModal(this.app, {
			lane,
			card,
			done: this.isDone(lane),
			settings: this.plugin.settings,
			renderText: (el, text) => this.renderInline(el, text),
			onEdit: () => this.openEdit(lane, card),
			onToggleSub: (i, done) => {
				const sub = card.subs[i];
				if (!sub) return;
				sub.done = done;
				this.commit();
			},
		}).open();
	}

	private async openTaskPicker(insert: (link: string) => void): Promise<void> {
		const refs = await this.plugin.collectTasks(this);
		new TaskPickerModal(this.app, refs, (ref) => {
			void this.linkFor(ref).then((link) => { if (link) insert(link); });
		}).open();
	}

	/** Gives the target task a block id if it has none, and returns a link to it. */
	private async linkFor(ref: TaskRef): Promise<string | null> {
		let bid = ref.bid;
		if (ref.path === this.file?.path) {
			const hit = this.board.lanes.flatMap((l) => l.cards).find((c) => c.id === ref.cardId);
			if (hit) {
				if (!hit.bid) { hit.bid = newBid(); this.commit(); }
				bid = hit.bid;
			}
		} else if (!bid) {
			bid = (await this.plugin.ensureBlockId(ref.path, ref.text)) ?? undefined;
		}
		const file = this.app.vault.getAbstractFileByPath(ref.path);
		if (!bid || !(file instanceof TFile)) { new Notice("Could not link to that task."); return null; }
		const link = this.app.metadataCache.fileToLinktext(file, this.file?.path ?? "");
		return `[[${link}#^${bid}|${ref.title.replace(/[[\]|]/g, " ")}]]`;
	}

	private openEdit(lane: Lane, card: Card): void {
		new TaskModal(this.app, {
			...this.modalBase(),
			heading: "Edit task",
			submitLabel: "Save",
			laneId: lane.id,
			text: card.text,
			desc: card.desc,
			subs: card.subs,
			onSubmit: (d: TaskData) => {
				card.text = d.text;
				card.desc = d.desc;
				card.subs = d.subs;
				if (d.laneId !== lane.id) {
					const to = this.board.lanes.find((l) => l.id === d.laneId);
					if (to) {
						lane.cards = lane.cards.filter((c) => c !== card);
						to.cards.push(card);
						logEvent(card, "moved", lane.title, to.title);
						this.handleRecurrence(to, card);
					}
				}
				this.commit();
			},
		}).open();
	}

	/* ------------------------------------------------------------ keyboard */

	private selectedCard(): { lane: Lane; card: Card; index: number } | null {
		if (!this.selected) return null;
		for (const lane of this.board.lanes) {
			const index = lane.cards.findIndex((c) => c.id === this.selected);
			if (index >= 0) return { lane, card: lane.cards[index], index };
		}
		return null;
	}

	private select(id: string | null, scroll = true): void {
		this.selected = id;
		this.contentEl.querySelectorAll(".kb-card.is-selected").forEach((n) => n.removeClass("is-selected"));
		if (!id) return;
		const el = this.contentEl.querySelector<HTMLElement>(`.kb-card[data-id="${id}"]`);
		el?.addClass("is-selected");
		if (scroll) el?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}

	private restoreFocus(): void {
		const doc = this.contentEl.ownerDocument;
		const active = doc.activeElement;
		if ((!active || active === doc.body) && this.app.workspace.getActiveViewOfType(KanbanView) === this) {
			this.contentEl.focus({ preventScroll: true });
		}
	}

	private moveSelection(dx: number, dy: number): void {
		const cols = this.board.lanes
			.filter((l) => !l.collapsed)
			.map((l) => ({ lane: l, cards: l.cards.filter((c) => this.matches(c, l)) }))
			.filter((c) => c.cards.length);
		if (!cols.length) return;
		let ci = cols.findIndex((c) => c.cards.some((x) => x.id === this.selected));
		if (ci < 0) { this.select(cols[0].cards[0].id); return; }
		let ri = cols[ci].cards.findIndex((x) => x.id === this.selected);
		if (dy) ri = Math.max(0, Math.min(cols[ci].cards.length - 1, ri + dy));
		if (dx) {
			ci = Math.max(0, Math.min(cols.length - 1, ci + dx));
			ri = Math.min(ri, cols[ci].cards.length - 1);
		}
		this.select(cols[ci].cards[ri].id);
	}

	/** Alt + arrows: reorder within a list, or move to the neighbouring list. */
	private shiftCard(sel: { lane: Lane; card: Card; index: number }, dx: number, dy: number): void {
		const { lane, card, index } = sel;
		if (dy) {
			const j = index + dy;
			if (j < 0 || j >= lane.cards.length) return;
			lane.cards.splice(index, 1);
			lane.cards.splice(j, 0, card);
			this.commit();
			return;
		}
		const to = this.board.lanes[this.board.lanes.indexOf(lane) + dx];
		if (!to) return;
		lane.cards.splice(index, 1);
		to.cards.splice(Math.min(index, to.cards.length), 0, card);
		logEvent(card, "moved", lane.title, to.title);
		this.handleRecurrence(to, card);
		this.commit();
	}

	private removeSelected(sel: { lane: Lane; card: Card; index: number }, archive: boolean): void {
		const { lane, card, index } = sel;
		const neighbour = lane.cards[index + 1] ?? lane.cards[index - 1];
		lane.cards = lane.cards.filter((c) => c !== card);
		if (archive) { logEvent(card, "archived", lane.title); this.board.archive.push(card); }
		this.selected = neighbour?.id ?? null;
		this.commit();
	}

	private onKey(e: KeyboardEvent): void {
		const t = e.target as HTMLElement;
		if (t.closest("input, textarea, select")) return;
		const raw = e.key;
		if (e.ctrlKey || e.metaKey) {
			const lk = raw.toLowerCase();
			if (lk === "z") { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); }
			else if (lk === "y") { e.preventDefault(); this.redo(); }
			return;
		}
		const sel = this.selectedCard();
		if (e.altKey) {
			if (this.mode !== "board" || !sel) return;
			const dirs: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
			const d = dirs[raw];
			if (d) { e.preventDefault(); this.shiftCard(sel, d[0], d[1]); }
			return;
		}
		const k = raw.length === 1 ? raw.toLowerCase() : raw;
		let handled = true;
		switch (k) {
			case "n": this.openCreate(sel?.lane.id); break;
			case "l": this.openAddList(); break;
			case "/": this.contentEl.querySelector<HTMLInputElement>(".kb-filter")?.focus(); break;
			case "b": this.mode = "board"; this.render(); break;
			case "c": this.mode = "calendar"; this.render(); break;
			case "?": new ShortcutsModal(this.app).open(); break;
			case "ArrowUp": if (this.mode === "board") this.moveSelection(0, -1); else handled = false; break;
			case "ArrowDown": if (this.mode === "board") this.moveSelection(0, 1); else handled = false; break;
			case "ArrowLeft": if (this.mode === "board") this.moveSelection(-1, 0); else handled = false; break;
			case "ArrowRight": if (this.mode === "board") this.moveSelection(1, 0); else handled = false; break;
			case "e": if (sel) this.openEdit(sel.lane, sel.card); else handled = false; break;
			case "Enter": if (sel && !t.closest("button")) this.openCard(sel.lane, sel.card); else handled = false; break;
			case "a": if (sel) this.removeSelected(sel, true); else handled = false; break;
			case "Delete":
			case "Backspace": if (sel) this.removeSelected(sel, false); else handled = false; break;
			case "1": if (sel) this.setPriority(sel.card, "high"); else handled = false; break;
			case "2": if (sel) this.setPriority(sel.card, "medium"); else handled = false; break;
			case "3": if (sel) this.setPriority(sel.card, "low"); else handled = false; break;
			case "0": if (sel) this.setPriority(sel.card, undefined); else handled = false; break;
			case "Escape":
				if (this.filterText || this.quick) { this.filterText = ""; this.quick = ""; this.render(); }
				else if (this.selected) this.select(null);
				else handled = false;
				break;
			default: handled = false;
		}
		if (handled) e.preventDefault();
	}

	/** Used by the agenda: show a board and highlight one card. */
	focusCard(match: { text?: string; bid?: string }): void {
		for (const lane of this.board.lanes) {
			const card = lane.cards.find((c) => (match.bid ? c.bid === match.bid : c.text === match.text));
			if (!card) continue;
			this.filterText = "";
			this.quick = "";
			this.mode = "board";
			this.selected = card.id;
			this.render();
			this.contentEl.querySelector<HTMLElement>(`.kb-card[data-id="${card.id}"]`)?.scrollIntoView({ block: "center", inline: "center" });
			return;
		}
	}

	private setPriority(card: Card, p: Priority | undefined): void {
		const t = takeTokens(card.text);
		card.text = composeCard(t.text, t.date, t.time, p, t.repeat);
		this.commit();
	}

	private cardMenu(lane: Lane, card: Card, e: MouseEvent): void {
		const cur = parseCard(card.text).priority;
		const menu = new Menu();
		menu.addItem((i) => i.setTitle("Details").setIcon("info").onClick(() => this.openDetail(lane, card)));
		menu.addItem((i) => i.setTitle("Edit").setIcon("pencil").onClick(() => this.openEdit(lane, card)));
		menu.addSeparator();
		(["high", "medium", "low"] as Priority[]).forEach((p) =>
			menu.addItem((i) => i.setTitle(`Priority: ${p}`).setChecked(cur === p).onClick(() => this.setPriority(card, cur === p ? undefined : p))));
		if (cur) menu.addItem((i) => i.setTitle("Clear priority").onClick(() => this.setPriority(card, undefined)));
		menu.addSeparator();
		menu.addItem((i) => i.setTitle("Duplicate").setIcon("copy").onClick(() => {
			const copy: Card = { ...card, id: uid(), bid: undefined, subs: card.subs.map((s) => ({ ...s })), log: [] };
			logEvent(copy, "created", undefined, lane.title);
			lane.cards.splice(lane.cards.indexOf(card) + 1, 0, copy);
			this.commit();
		}));
		menu.addItem((i) => i.setTitle("Convert to note").setIcon("file-plus").onClick(() => void this.cardToNote(card)));
		menu.addItem((i) => i.setTitle("Archive").setIcon("archive").onClick(() => {
			lane.cards = lane.cards.filter((c) => c !== card);
			logEvent(card, "archived", lane.title);
			this.board.archive.push(card);
			this.commit();
		}));
		menu.addSeparator();
		for (const other of this.board.lanes) {
			if (other === lane) continue;
			menu.addItem((i) => i.setTitle(`Move to ${other.title}`).setIcon("arrow-right").onClick(() => {
				lane.cards = lane.cards.filter((c) => c !== card);
				other.cards.push(card);
				logEvent(card, "moved", lane.title, other.title);
				this.handleRecurrence(other, card);
				this.commit();
			}));
		}
		menu.addSeparator();
		menu.addItem((i) => i.setTitle("Delete").setIcon("trash").onClick(() => {
			lane.cards = lane.cards.filter((c) => c !== card);
			this.commit();
		}));
		menu.showAtMouseEvent(e);
	}

	/** Creates a note from the card (notes and subtasks go inside it) and leaves a link on the card. */
	private async cardToNote(card: Card): Promise<void> {
		const info = parseCard(card.text);
		const plain = info.title.replace(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, "$1");
		const base = plain.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Task";
		const folder = this.file?.parent?.path ?? "";
		const pathOf = (n: string): string => normalizePath(`${folder}/${n}.md`);
		let name = base;
		for (let i = 1; this.app.vault.getAbstractFileByPath(pathOf(name)); i++) name = `${base} ${i}`;

		let body = `# ${plain || "Task"}\n\n`;
		if (info.date) body += `Due: ${info.date}${info.time ? ` ${info.time}` : ""}\n\n`;
		if (card.desc) body += `${card.desc}\n\n`;
		if (card.subs.length) body += card.subs.map((s) => `- [${s.done ? "x" : " "}] ${s.text}`).join("\n") + "\n\n";
		const labels = [...info.tags.map((t) => `#${t}`), ...info.contexts.map((c) => `@${c}`)].join(" ");
		if (info.tags.length) body += `${info.tags.map((t) => `#${t}`).join(" ")}\n`;

		try {
			await this.app.vault.create(pathOf(name), body);
		} catch {
			new Notice("Could not create the note.");
			return;
		}
		card.text = composeCard(`[[${name}]] ${labels}`.trim(), info.date, info.time, info.priority, info.repeat);
		card.desc = "";
		card.subs = [];
		this.commit();
		new Notice(`Created note “${name}”.`);
	}

	/* ------------------------------------------------------------ archive */

	private openArchive(): void {
		new ArchiveModal(
			this.app,
			() => this.board.archive,
			(c) => {
				const target = this.board.lanes.find((l) => !this.isDone(l)) ?? this.board.lanes[0];
				if (!target) { new Notice("Add a list first."); return; }
				this.board.archive = this.board.archive.filter((x) => x !== c);
				logEvent(c, "restored", undefined, target.title);
				target.cards.push(c);
				this.commit();
			},
			(c) => { this.board.archive = this.board.archive.filter((x) => x !== c); this.commit(); },
			() => { this.board.archive = []; this.commit(); },
		).open();
	}

	/* ------------------------------------------------------------ lanes */

	private openAddList(): void {
		new PromptModal(this.app, "Add list", "List title…", "Add list", (title) => {
			if (!title) return;
			this.board.lanes.push({ id: uid(), title, cards: [] });
			this.commit();
		}).open();
	}

	private setCollapsed(lane: Lane, collapsed: boolean): void {
		lane.collapsed = collapsed || undefined;
		this.commit();
	}

	private renameLane(lane: Lane, titleEl: HTMLElement, head: HTMLElement): void {
		head.draggable = false;
		const input = createEl("input", { type: "text", cls: "kb-lane-title-input" });
		input.value = lane.title;
		titleEl.replaceWith(input);
		input.focus();
		input.select();
		let done = false;
		const finish = (save: boolean): void => {
			if (done) return;
			done = true;
			const v = input.value.trim();
			if (save && v && v !== lane.title) { lane.title = v; this.commit(); } else this.render();
		};
		input.onblur = () => finish(true);
		input.onkeydown = (e) => { if (e.key === "Enter") finish(true); else if (e.key === "Escape") finish(false); };
	}

	private laneMenu(lane: Lane, e: MouseEvent): void {
		const lanes = this.board.lanes;
		const i = lanes.indexOf(lane);
		const menu = new Menu();
		menu.addItem((m) => m.setTitle("Rename list").setIcon("pencil").onClick(() => {
			const el = this.contentEl.querySelector<HTMLElement>(`.kb-lane[data-id="${lane.id}"]`);
			const title = el?.querySelector<HTMLElement>(".kb-lane-title");
			const head = el?.querySelector<HTMLElement>(".kb-lane-header");
			if (title && head) this.renameLane(lane, title, head);
		}));
		menu.addItem((m) => m.setTitle("Add task").setIcon("plus").onClick(() => this.openCreate(lane.id)));
		menu.addItem((m) => m.setTitle(lane.collapsed ? "Expand list" : "Collapse list").setIcon("chevrons-left-right").onClick(() => this.setCollapsed(lane, !lane.collapsed)));
		menu.addItem((m) => m.setTitle(lane.limit ? `Card limit: ${lane.limit}` : "Set card limit").setIcon("gauge").onClick(() => {
			new PromptModal(this.app, "Card limit", "Maximum number of cards (empty = no limit)", "Save", (v) => {
				const n = parseInt(v, 10);
				lane.limit = n > 0 ? n : undefined;
				this.commit();
			}, lane.limit ? String(lane.limit) : "").open();
		}));
		menu.addItem((m) => m.setTitle("Sort by due date").setIcon("calendar").onClick(() => {
			const key = (c: Card): string => { const p = parseCard(c.text); return p.date ? `${p.date} ${p.time ?? "99:99"}` : "9999"; };
			lane.cards.sort((a, b) => key(a).localeCompare(key(b)));
			this.commit();
		}));
		menu.addSeparator();
		if (i > 0) menu.addItem((m) => m.setTitle("Move left").setIcon("arrow-left").onClick(() => this.moveLane(lane.id, i - 1)));
		if (i < lanes.length - 1) menu.addItem((m) => m.setTitle("Move right").setIcon("arrow-right").onClick(() => this.moveLane(lane.id, i + 1)));
		menu.addSeparator();
		if (lane.cards.length) menu.addItem((m) => m.setTitle("Archive all cards").setIcon("archive").onClick(() => {
			lane.cards.forEach((c) => logEvent(c, "archived", lane.title));
			this.board.archive.push(...lane.cards);
			lane.cards = [];
			this.commit();
		}));
		menu.addItem((m) => m.setTitle("Delete list").setIcon("trash").onClick(() => {
			const remove = (): void => { this.board.lanes = this.board.lanes.filter((l) => l !== lane); this.commit(); };
			if (lane.cards.length && this.plugin.settings.confirmDelete)
				new ConfirmModal(this.app, "Delete list", `Delete "${lane.title}" and its ${lane.cards.length} task(s)?`, "Delete", remove).open();
			else remove();
		}));
		menu.showAtMouseEvent(e);
	}
}
