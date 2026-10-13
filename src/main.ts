import {
	App, Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo,
	MarkdownView, Notice, Plugin, TFile, WorkspaceLeaf, normalizePath,
} from "obsidian";
import { DEFAULT_SETTINGS, KanbanSettings, KanbanSettingTab } from "./settings";
import { KanbanView, VIEW_TYPE } from "./view";
import { isBoard, newBoardText, parseBoard, parseCard } from "./parser";

const SLASH_COMMAND = "create-kanban";

export default class KanbanFlowPlugin extends Plugin {
	settings!: KanbanSettings;
	/** Files the user deliberately opened as plain markdown (so we don't flip them back). */
	private markdownOverride = new Set<string>();

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(VIEW_TYPE, (leaf) => new KanbanView(leaf, this));
		this.registerHoverLinkSource(VIEW_TYPE, { display: "Kanban Flow", defaultMod: true });
		this.addSettingTab(new KanbanSettingTab(this.app, this));
		this.registerEditorSuggest(new SlashSuggest(this.app, this));

		this.addRibbonIcon("layout-dashboard", "Create new kanban board", () => void this.createBoardFile());

		this.addCommand({
			id: "create-board-file",
			name: "Create new kanban board",
			callback: () => void this.createBoardFile(),
		});
		this.addCommand({
			id: "create-board-in-note",
			name: "Create kanban board in current note",
			editorCheckCallback: (checking, editor, ctx) => {
				if (!(ctx instanceof MarkdownView)) return false;
				if (!checking) void this.insertBoard(editor, ctx);
				return true;
			},
		});
		this.addCommand({
			id: "add-task",
			name: "Add task to current board",
			checkCallback: (checking) => {
				const v = this.app.workspace.getActiveViewOfType(KanbanView);
				if (!v) return false;
				if (!checking) v.openCreate();
				return true;
			},
		});
		this.addCommand({
			id: "undo",
			name: "Undo last board change",
			checkCallback: (checking) => {
				const v = this.app.workspace.getActiveViewOfType(KanbanView);
				if (!v) return false;
				if (!checking) v.undo();
				return true;
			},
		});
		this.addCommand({
			id: "redo",
			name: "Redo board change",
			checkCallback: (checking) => {
				const v = this.app.workspace.getActiveViewOfType(KanbanView);
				if (!v) return false;
				if (!checking) v.redo();
				return true;
			},
		});
		this.addCommand({
			id: "toggle-view",
			name: "Toggle between board and markdown view",
			checkCallback: (checking) => {
				const kv = this.app.workspace.getActiveViewOfType(KanbanView);
				if (kv) {
					if (!checking) void this.openAsMarkdown(kv.leaf);
					return true;
				}
				const mv = this.app.workspace.getActiveViewOfType(MarkdownView);
				const isBoardNote = !!mv?.file && !!this.app.metadataCache.getFileCache(mv.file)?.frontmatter?.["kanban-plugin"];
				if (!mv || !isBoardNote) return false;
				if (!checking) void this.switchToKanban(mv.leaf);
				return true;
			},
		});

		// Open notes that are boards in the kanban view.
		this.registerEvent(this.app.workspace.on("file-open", () => {
			const v = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (v) void this.maybeSwitch(v.leaf);
		}));
		this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => { if (leaf) void this.maybeSwitch(leaf); }));
		this.app.workspace.onLayoutReady(() => {
			this.app.workspace.iterateAllLeaves((l) => void this.maybeSwitch(l));
			window.setTimeout(() => void this.checkReminders(), 5000);
		});
		this.registerInterval(window.setInterval(() => void this.checkReminders(), 30000));
	}

	isDoneTitle(title: string): boolean {
		return title.trim().toLowerCase() === this.settings.doneList.trim().toLowerCase();
	}

	private reminderCache = new Map<string, { mtime: number; cards: { key: string; title: string; date: string; time: string; lane: string }[] }>();

	/**
	 * Shows a notice once for every task whose due time (minus the lead time) has just passed.
	 * Boards are only re-read when the file changed, and a reminder is identified by file + title + date + time,
	 * so editing tags, notes, priority or moving the card does not trigger it again.
	 */
	private async checkReminders(): Promise<void> {
		const s = this.settings;
		if (!s.reminders) return;
		const now = Date.now();
		let changed = false;
		const seen = new Set<string>();
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (!this.app.metadataCache.getFileCache(file)?.frontmatter?.["kanban-plugin"]) continue;
			seen.add(file.path);
			let entry = this.reminderCache.get(file.path);
			if (!entry || entry.mtime !== file.stat.mtime) {
				const board = parseBoard(await this.app.vault.cachedRead(file));
				const cards: { key: string; title: string; date: string; time: string; lane: string }[] = [];
				for (const lane of board.lanes) {
					if (this.isDoneTitle(lane.title)) continue;
					for (const card of lane.cards) {
						const info = parseCard(card.text);
						if (!info.date || !info.time) continue;
						cards.push({ key: `${file.path}::${info.date} ${info.time}::${info.title}`, title: info.title, date: info.date, time: info.time, lane: lane.title });
					}
				}
				entry = { mtime: file.stat.mtime, cards };
				this.reminderCache.set(file.path, entry);
			}
			for (const c of entry.cards) {
				const due = new Date(`${c.date}T${c.time}:00`).getTime() - s.reminderLead * 60000;
				if (Number.isNaN(due) || due > now || due < now - 3600000) continue;
				if (s.notified.includes(c.key)) continue;
				s.notified.push(c.key);
				changed = true;
				new Notice(`Due ${s.reminderLead ? `in ${s.reminderLead} min` : "now"}: ${c.title || "Task"}\n${file.basename} · ${c.lane}`, 15000);
			}
		}
		for (const path of Array.from(this.reminderCache.keys())) if (!seen.has(path)) this.reminderCache.delete(path);
		if (changed) {
			s.notified = s.notified.slice(-300);
			await this.saveData(s);
		}
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		this.settings.notified = Array.isArray(this.settings.notified) ? this.settings.notified : [];
	}

	async saveSettings(): Promise<void> {
		this.reminderCache.clear();
		await this.saveData(this.settings);
		this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((l) => { if (l.view instanceof KanbanView) l.view.render(); });
	}

	/* ---------------- view switching ---------------- */

	private async maybeSwitch(leaf: WorkspaceLeaf): Promise<void> {
		if (!this.settings.autoOpenBoards) return;
		const view = leaf.view;
		if (!(view instanceof MarkdownView) || !view.file) return;
		if (this.markdownOverride.has(view.file.path)) return;
		const content = await this.app.vault.cachedRead(view.file);
		if (leaf.view === view && isBoard(content)) await this.switchToKanban(leaf);
	}

	async switchToKanban(leaf: WorkspaceLeaf): Promise<void> {
		if (leaf.view instanceof KanbanView) return;
		const file = (leaf.view as MarkdownView).file;
		if (file) this.markdownOverride.delete(file.path);
		await leaf.setViewState({ type: VIEW_TYPE, state: leaf.view.getState(), active: true });
	}

	async openAsMarkdown(leaf: WorkspaceLeaf): Promise<void> {
		const file = (leaf.view as KanbanView).file;
		if (file) this.markdownOverride.add(file.path);
		await leaf.setViewState({ type: "markdown", state: leaf.view.getState(), active: true });
	}

	/* ---------------- creating boards ---------------- */

	private boardText(): string {
		const titles = this.settings.defaultLists.split(",").map((t) => t.trim()).filter(Boolean);
		return newBoardText(titles.length ? titles : ["To do", "Doing", "Done"]);
	}

	async createBoardFile(): Promise<void> {
		const folder = this.app.fileManager.getNewFileParent(this.app.workspace.getActiveFile()?.path ?? "");
		let path = "";
		for (let i = 0; ; i++) {
			path = normalizePath(`${folder.path}/Kanban board${i ? ` ${i}` : ""}.md`);
			if (!this.app.vault.getAbstractFileByPath(path)) break;
		}
		const file: TFile = await this.app.vault.create(path, this.boardText());
		const leaf = this.app.workspace.getLeaf(true);
		await leaf.openFile(file);
		await this.switchToKanban(leaf);
	}

	/** Turn the (empty) note in this editor into a board. */
	async insertBoard(editor: Editor, view: MarkdownView): Promise<void> {
		if (editor.getValue().trim()) {
			new Notice("A kanban board can only be created in an empty note.");
			return;
		}
		editor.setValue(this.boardText());
		await view.save();
		await this.switchToKanban(view.leaf);
	}
}

/** Typing "/create-kanban" in a note offers to turn it into a board. */
class SlashSuggest extends EditorSuggest<string> {
	constructor(app: App, private plugin: KanbanFlowPlugin) {
		super(app);
	}

	onTrigger(cursor: EditorPosition, editor: Editor): EditorSuggestTriggerInfo | null {
		const before = editor.getLine(cursor.line).slice(0, cursor.ch);
		const m = /^(\s*)\/([\w-]*)$/.exec(before);
		if (!m) return null;
		return { start: { line: cursor.line, ch: m[1].length }, end: cursor, query: m[2] };
	}

	getSuggestions(ctx: EditorSuggestContext): string[] {
		const q = ctx.query.toLowerCase();
		return SLASH_COMMAND.includes(q) || "kanban".startsWith(q) ? [SLASH_COMMAND] : [];
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		el.createDiv({ text: `/${value}` });
		el.createEl("small", { text: "Turn this note into a kanban board" });
	}

	selectSuggestion(): void {
		const ctx = this.context;
		if (!ctx) return;
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		ctx.editor.replaceRange("", ctx.start, ctx.end);
		if (view) void this.plugin.insertBoard(ctx.editor, view);
	}
}
