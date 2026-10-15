import { ItemView, TAbstractFile, TFile, WorkspaceLeaf } from "obsidian";
import type KanbanFlowPlugin from "./main";
import { Card, CardInfo, isBoard, isoDate, parseBoard, parseCard, todayISO } from "./parser";
import { applyTagColor, formatDue, iconButton, iconText, isOverdue } from "./utils";

export const AGENDA_TYPE = "kanban-flow-agenda";

interface Item { path: string; board: string; lane: string; done: boolean; card: Card; info: CardInfo }

/** One list of tasks from every board in the vault, grouped by due date. */
export class AgendaView extends ItemView {
	private items = new Map<string, Item[]>();
	private listEl!: HTMLElement;
	private filterText = "";
	private showDone = false;
	private showUndated = false;
	private pending = new Set<string>();
	private timer = 0;
	private rescanned = false;

	constructor(leaf: WorkspaceLeaf, private plugin: KanbanFlowPlugin) {
		super(leaf);
	}

	getViewType(): string { return AGENDA_TYPE; }
	getDisplayText(): string { return "Kanban agenda"; }
	getIcon(): string { return "list-checks"; }

	async onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass("kb-view");
		root.addClass("kb-agenda");

		const bar = root.createDiv("kb-toolbar");
		const search = bar.createDiv("kb-search");
		iconText(search.createSpan("kb-search-icon"), "search", "⌕");
		const input = search.createEl("input", { type: "text", cls: "kb-filter", attr: { placeholder: "Filter all boards", "aria-label": "Filter all boards" } });
		input.oninput = () => { this.filterText = input.value; this.render(); };

		const actions = bar.createDiv("kb-actions");
		const doneBtn = iconButton(actions, "check-circle", "Show completed tasks", "✓");
		doneBtn.onclick = () => { this.showDone = !this.showDone; doneBtn.toggleClass("is-active", this.showDone); this.render(); };
		const undatedBtn = iconButton(actions, "calendar-x", "Show tasks without a date", "∅");
		undatedBtn.onclick = () => { this.showUndated = !this.showUndated; undatedBtn.toggleClass("is-active", this.showUndated); this.render(); };

		this.listEl = root.createDiv("kb-ag-list");
		await this.scanAll();
		this.render();

		this.registerEvent(this.app.vault.on("modify", (f) => this.queue(f)));
		this.registerEvent(this.app.vault.on("delete", (f) => { this.items.delete(f.path); this.render(); }));
		this.registerEvent(this.app.vault.on("rename", (f, old) => { this.items.delete(old); this.queue(f); }));
		this.registerEvent(this.app.metadataCache.on("resolved", () => {
			if (this.rescanned) return;
			this.rescanned = true;
			void this.scanAll().then(() => this.render());
		}));
	}

	async onClose(): Promise<void> {
		window.clearTimeout(this.timer);
	}

	private async scanAll(): Promise<void> {
		this.items.clear();
		for (const f of this.app.vault.getMarkdownFiles()) {
			if (this.app.metadataCache.getFileCache(f)?.frontmatter?.["kanban-plugin"]) await this.loadFile(f);
		}
	}

	private queue(f: TAbstractFile): void {
		if (!(f instanceof TFile) || f.extension !== "md") return;
		this.pending.add(f.path);
		window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => {
			const paths = Array.from(this.pending);
			this.pending.clear();
			void (async () => {
				for (const path of paths) {
					const file = this.app.vault.getAbstractFileByPath(path);
					if (file instanceof TFile) await this.loadFile(file); else this.items.delete(path);
				}
				this.render();
			})();
		}, 400);
	}

	private async loadFile(file: TFile): Promise<void> {
		const content = await this.app.vault.cachedRead(file);
		if (!isBoard(content)) { this.items.delete(file.path); return; }
		const board = parseBoard(content);
		const list: Item[] = [];
		for (const lane of board.lanes) {
			const done = this.plugin.isDoneTitle(lane.title);
			for (const card of lane.cards) list.push({ path: file.path, board: file.basename, lane: lane.title, done, card, info: parseCard(card.text) });
		}
		this.items.set(file.path, list);
	}

	private matches(it: Item): boolean {
		const q = this.filterText.trim().toLowerCase();
		if (!q) return true;
		const hay = `${it.info.title} ${it.card.desc} ${it.board} ${it.lane}`.toLowerCase();
		for (const tok of q.split(/\s+/)) {
			if (tok.startsWith("#")) { if (!it.info.tags.some((t) => t.toLowerCase().startsWith(tok.slice(1)))) return false; }
			else if (tok.startsWith("@")) { if (!it.info.contexts.some((c) => c.toLowerCase().startsWith(tok.slice(1)))) return false; }
			else if (tok.startsWith("prio:")) { if (it.info.priority !== tok.slice(5)) return false; }
			else if (!hay.includes(tok)) return false;
		}
		return true;
	}

	render(): void {
		const s = this.plugin.settings;
		const list = this.listEl;
		list.empty();

		const day = (n: number): string => { const d = new Date(); d.setDate(d.getDate() + n); return isoDate(d); };
		const today = todayISO();
		const tomorrow = day(1);
		const weekEnd = day(7);

		const groups: [string, Item[]][] = [["Overdue", []], ["Today", []], ["Tomorrow", []], ["Next 7 days", []], ["Later", []], ["No date", []], ["Earlier (completed)", []]];
		for (const it of Array.from(this.items.values()).flat()) {
			if (!this.showDone && it.done) continue;
			if (!this.matches(it)) continue;
			const date = it.info.date;
			let g: number;
			if (!date) g = 5;
			else if (date < today) g = it.done ? 6 : 0;
			else if (date === today) g = 1;
			else if (date === tomorrow) g = 2;
			else if (date <= weekEnd) g = 3;
			else g = 4;
			if (g === 5 && !this.showUndated) continue;
			groups[g][1].push(it);
		}

		const key = (it: Item): string => `${it.info.date ?? "9999"} ${it.info.time ?? "99:99"} ${it.board}`;
		let any = false;
		for (const [title, items] of groups) {
			if (!items.length) continue;
			any = true;
			items.sort((a, b) => key(a).localeCompare(key(b)));
			const head = list.createDiv("kb-ag-head");
			head.createSpan({ text: title });
			head.createSpan({ cls: "kb-count", text: String(items.length) });
			for (const it of items) this.renderRow(list, it, s);
		}
		if (!any) list.createDiv({ cls: "kb-hint kb-ag-empty", text: "Nothing here. Tasks with a due date from all your boards show up in this view." });
	}

	private renderRow(parent: HTMLElement, it: Item, s: KanbanFlowPlugin["settings"]): void {
		const cls = ["kb-ag-row"];
		if (it.info.priority) cls.push(`kb-prio-${it.info.priority}`);
		if (it.done) cls.push("is-done");
		const row = parent.createDiv({ cls });

		const main = row.createDiv("kb-ag-main");
		const title = it.info.title.replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_m, a: string, b?: string) => b || a) || "Untitled";
		main.createDiv({ cls: "kb-ag-title", text: title });
		main.createDiv({ cls: "kb-ag-sub", text: `${it.board} · ${it.lane}` });
		if (it.info.tags.length) {
			const tags = main.createDiv("kb-ag-tags");
			for (const t of it.info.tags) applyTagColor(tags.createSpan({ cls: "kb-tag", text: t }), t, s);
		}

		if (it.info.date) {
			const overdue = !it.done && isOverdue(it.info);
			row.createDiv({ cls: overdue ? ["kb-ag-due", "is-overdue"] : ["kb-ag-due"], text: formatDue(it.info.date, it.info.time, s) });
		}
		row.onclick = () => void this.plugin.openBoardAt(it.path, { text: it.card.text });
	}
}
