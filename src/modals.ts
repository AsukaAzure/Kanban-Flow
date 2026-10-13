import { App, FuzzySuggestModal, Modal, Notice, TFile, setIcon } from "obsidian";
import { Card, Priority, Sub, composeCard, extractSchedule, parseCard, takeTokens, todayISO } from "./parser";

export interface TaskData { laneId: string; text: string; desc: string; subs: Sub[] }

export interface TaskModalOptions {
	heading: string;
	submitLabel: string;
	lanes: { id: string; title: string }[];
	laneId: string;
	text: string; // raw stored card text (empty for new cards)
	desc: string;
	subs: Sub[];
	sourcePath: string;
	tags: string[];
	contexts: string[];
	onSubmit: (data: TaskData) => void;
}

const REPEATS: [string, string][] = [
	["", "No repeat"], ["every day", "Every day"], ["every weekday", "Every weekday"],
	["every week", "Every week"], ["every month", "Every month"], ["every year", "Every year"],
];

function ensureOption(sel: HTMLSelectElement, value: string): void {
	if (value && !Array.from(sel.options).some((o) => o.value === value)) {
		sel.createEl("option", { value, text: value.charAt(0).toUpperCase() + value.slice(1) });
	}
}

/** Small suggestion popup for [[notes]], #tags and @contexts typed in a textarea. */
function attachSuggest(app: App, ta: HTMLTextAreaElement, host: HTMLElement, tags: string[], contexts: string[], sourcePath: string): void {
	const box = host.createDiv("kb-suggest");
	box.hide();
	let items: { label: string; insert: string; start: number; end: number }[] = [];
	let sel = 0;

	const close = (): void => { items = []; box.hide(); };
	const draw = (): void => {
		box.empty();
		items.forEach((it, i) => {
			const row = box.createDiv({ cls: i === sel ? ["kb-suggest-item", "is-selected"] : ["kb-suggest-item"], text: it.label });
			row.addEventListener("mousedown", (e) => { e.preventDefault(); accept(i); });
		});
		if (items.length) box.show(); else box.hide();
	};
	const accept = (i: number): void => {
		const it = items[i];
		if (!it) return;
		ta.setRangeText(it.insert, it.start, it.end, "end");
		close();
		ta.dispatchEvent(new Event("input"));
	};
	const update = (): void => {
		const pos = ta.selectionStart;
		const before = ta.value.slice(0, pos);
		let list: { label: string; insert: string }[] = [];
		let start = pos;
		const link = /\[\[([^\]\n]*)$/.exec(before);
		if (link) {
			const q = link[1].toLowerCase();
			start = pos - link[0].length;
			list = app.vault.getMarkdownFiles()
				.filter((f) => f.basename.toLowerCase().includes(q))
				.slice(0, 8)
				.map((f) => ({ label: f.basename, insert: `[[${app.metadataCache.fileToLinktext(f, sourcePath)}]] ` }));
		} else {
			const m = /(^|\s)([#@])([^\s#@]*)$/.exec(before);
			if (m) {
				const sym = m[2];
				const q = m[3].toLowerCase();
				start = pos - m[3].length - 1;
				list = (sym === "#" ? tags : contexts)
					.filter((x) => x.toLowerCase().startsWith(q) && x.toLowerCase() !== q)
					.slice(0, 8)
					.map((x) => ({ label: `${sym}${x}`, insert: `${sym}${x} ` }));
			}
		}
		items = list.map((l) => ({ ...l, start, end: pos }));
		sel = 0;
		draw();
	};

	ta.addEventListener("input", update);
	ta.addEventListener("click", update);
	ta.addEventListener("keydown", (e) => {
		if (!items.length) return;
		if (e.key === "ArrowDown") { e.preventDefault(); sel = (sel + 1) % items.length; draw(); }
		else if (e.key === "ArrowUp") { e.preventDefault(); sel = (sel - 1 + items.length) % items.length; draw(); }
		else if ((e.key === "Enter" || e.key === "Tab") && !e.ctrlKey && !e.metaKey) { e.preventDefault(); e.stopPropagation(); accept(sel); }
		else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
	});
	ta.addEventListener("blur", close);
}

export class TaskModal extends Modal {
	constructor(app: App, private opts: TaskModalOptions) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, opts } = this;
		contentEl.addClass("kb-task-modal");
		this.titleEl.setText(opts.heading);
		const init = takeTokens(opts.text);
		const subs: Sub[] = opts.subs.map((s) => ({ ...s }));

		const wrap = contentEl.createDiv("kb-ta-wrap");
		const ta = wrap.createEl("textarea", {
			cls: "kb-task-input",
			attr: { placeholder: "Buy groceries tomorrow at 3pm @home #errands", rows: "2" },
		});
		ta.value = init.text;
		attachSuggest(this.app, ta, wrap, opts.tags, opts.contexts, opts.sourcePath);
		const topRow = contentEl.createDiv("kb-task-top");
		const preview = topRow.createDiv("kb-task-preview");
		const tools = topRow.createDiv("kb-task-links");
		const iconBtn = (name: string, label: string, fallback: string): HTMLButtonElement => {
			const b = tools.createEl("button", { cls: "kb-btn", attr: { "aria-label": label, title: label } });
			setIcon(b, name);
			if (!b.querySelector("svg")) b.setText(fallback);
			return b;
		};
		const linkBtn = iconBtn("link", "Link a note", "Note");
		const siteBtn = iconBtn("globe", "Link a website", "Web");

		const fields = contentEl.createDiv("kb-fields");
		const field = (label: string, wide = false): HTMLElement => {
			const f = fields.createDiv({ cls: wide ? ["kb-field", "is-wide"] : ["kb-field"] });
			f.createEl("label", { text: label });
			return f;
		};
		const laneSel = field("List").createEl("select", { cls: "dropdown" });
		for (const l of opts.lanes) laneSel.createEl("option", { value: l.id, text: l.title });
		laneSel.value = opts.laneId;
		const prioSel = field("Priority").createEl("select", { cls: "dropdown" });
		[["", "None"], ["high", "High"], ["medium", "Medium"], ["low", "Low"]].forEach(([v, l]) => prioSel.createEl("option", { value: v, text: l }));
		prioSel.value = init.priority ?? "";
		const dateIn = field("Date").createEl("input", { type: "date" });
		dateIn.value = init.date ?? "";
		const timeIn = field("Time").createEl("input", { type: "time" });
		timeIn.value = init.time ?? "";
		const repeatSel = field("Repeat", true).createEl("select", { cls: "dropdown" });
		REPEATS.forEach(([v, l]) => repeatSel.createEl("option", { value: v, text: l }));
		if (init.repeat) ensureOption(repeatSel, init.repeat);
		repeatSel.value = init.repeat ?? "";

		contentEl.createDiv({ cls: "kb-field-label", text: "Notes" });
		const descTa = contentEl.createEl("textarea", { cls: "kb-notes-input", attr: { placeholder: "Add details…", rows: "2" } });
		descTa.value = opts.desc;

		contentEl.createDiv({ cls: "kb-field-label", text: "Subtasks" });
		const subsEl = contentEl.createDiv("kb-subs");
		const renderSubs = (focusIdx = -1): void => {
			subsEl.empty();
			subs.forEach((s, i) => {
				const row = subsEl.createDiv("kb-sub-row");
				const cb = row.createEl("input", { type: "checkbox" });
				cb.checked = s.done;
				cb.onchange = () => { s.done = cb.checked; };
				const inp = row.createEl("input", { type: "text", cls: "kb-sub-input", attr: { placeholder: "Subtask" } });
				inp.value = s.text;
				inp.oninput = () => { s.text = inp.value; };
				inp.onkeydown = (e) => {
					if (e.key === "Enter") { e.preventDefault(); subs.splice(i + 1, 0, { text: "", done: false }); renderSubs(i + 1); }
					else if (e.key === "Backspace" && !inp.value) { e.preventDefault(); subs.splice(i, 1); renderSubs(Math.max(0, i - 1)); }
				};
				const del = row.createSpan({ cls: "kb-icon-btn", text: "×", attr: { "aria-label": "Remove subtask" } });
				del.onclick = () => { subs.splice(i, 1); renderSubs(); };
				if (i === focusIdx) window.setTimeout(() => inp.focus(), 0);
			});
			const add = subsEl.createEl("button", { text: "+ Add subtask", cls: "kb-sub-add" });
			add.onclick = () => { subs.push({ text: "", done: false }); renderSubs(subs.length - 1); };
		};
		renderSubs();

		const footer = contentEl.createDiv("kb-task-footer");
		const saveBtn = footer.createEl("button", { text: opts.submitLabel, cls: "mod-cta" });
		const cancelBtn = footer.createEl("button", { text: "Cancel" });

		const build = (): { text: string; title: string } => {
			const r = extractSchedule(ta.value);
			let date = dateIn.value || undefined;
			const time = timeIn.value || undefined;
			const repeat = repeatSel.value || undefined;
			if ((time || repeat) && !date) date = todayISO();
			return { text: composeCard(r.text, date, time, (prioSel.value || undefined) as Priority | undefined, repeat), title: r.text };
		};

		const refresh = (): void => {
			preview.empty();
			const info = parseCard(build().text);
			const chips: string[] = [];
			info.tags.forEach((t) => chips.push(`#${t}`));
			info.contexts.forEach((c) => chips.push(`@${c}`));
			if (info.repeat) chips.push(info.repeat);
			chips.forEach((c) => preview.createSpan({ cls: "kb-chip", text: c }));
		};

		// Values filled in from typed text are cleared again when that text is removed.
		const auto = { d: false, t: false, p: false, r: false };
		const sync = (key: "d" | "t" | "p" | "r", val: string | undefined, set: (v: string) => void): void => {
			if (val) { set(val); auto[key] = true; }
			else if (auto[key]) { set(""); auto[key] = false; }
		};
		ta.addEventListener("input", () => {
			const r = extractSchedule(ta.value);
			sync("d", r.date, (v) => { dateIn.value = v; });
			sync("t", r.time, (v) => { timeIn.value = v; });
			sync("p", r.priority, (v) => { prioSel.value = v; });
			sync("r", r.repeat, (v) => { ensureOption(repeatSel, v); repeatSel.value = v; });
			refresh();
		});
		dateIn.addEventListener("change", () => { auto.d = false; refresh(); });
		timeIn.addEventListener("change", () => { auto.t = false; refresh(); });
		prioSel.addEventListener("change", () => { auto.p = false; refresh(); });
		repeatSel.addEventListener("change", () => {
			auto.r = false;
			if (repeatSel.value && !dateIn.value) dateIn.value = todayISO();
			refresh();
		});

		const submit = (): void => {
			const b = build();
			if (!b.title && !parseCard(b.text).tags.length) {
				new Notice("Write something for the task first.");
				return;
			}
			opts.onSubmit({
				laneId: laneSel.value,
				text: b.text,
				desc: descTa.value.trim(),
				subs: subs.filter((s) => s.text.trim()).map((s) => ({ text: s.text.trim(), done: s.done })),
			});
			this.close();
		};
		saveBtn.onclick = submit;
		cancelBtn.onclick = () => this.close();
		ta.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); }
		});

		linkBtn.onclick = () => {
			new NoteSuggestModal(this.app, (file) => {
				const link = `[[${this.app.metadataCache.fileToLinktext(file, opts.sourcePath)}]]`;
				ta.setRangeText(link, ta.selectionStart, ta.selectionEnd, "end");
				ta.focus();
				ta.dispatchEvent(new Event("input"));
			}).open();
		};
		siteBtn.onclick = () => {
			new UrlModal(this.app, (url, label) => {
				const link = label ? `[${label}](${url})` : url;
				ta.setRangeText(link, ta.selectionStart, ta.selectionEnd, "end");
				ta.focus();
				ta.dispatchEvent(new Event("input"));
			}).open();
		};

		refresh();
		window.setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 0);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class NoteSuggestModal extends FuzzySuggestModal<TFile> {
	constructor(app: App, private onChoose: (f: TFile) => void) {
		super(app);
		this.setPlaceholder("Link to a note…");
	}
	getItems(): TFile[] { return this.app.vault.getMarkdownFiles(); }
	getItemText(f: TFile): string { return f.path; }
	onChooseItem(f: TFile): void { this.onChoose(f); }
}

export class ConfirmModal extends Modal {
	constructor(app: App, private heading: string, private message: string, private confirmLabel: string, private onConfirm: () => void) {
		super(app);
	}
	onOpen(): void {
		this.titleEl.setText(this.heading);
		this.contentEl.createEl("p", { text: this.message });
		const row = this.contentEl.createDiv("kb-task-footer");
		const ok = row.createEl("button", { text: this.confirmLabel, cls: "mod-warning" });
		const cancel = row.createEl("button", { text: "Cancel" });
		ok.onclick = () => { this.close(); this.onConfirm(); };
		cancel.onclick = () => this.close();
	}
	onClose(): void { this.contentEl.empty(); }
}

export class UrlModal extends Modal {
	constructor(app: App, private onSubmit: (url: string, label: string) => void) {
		super(app);
	}
	onOpen(): void {
		this.titleEl.setText("Link a website");
		const url = this.contentEl.createEl("input", { type: "text", cls: "kb-url-input", attr: { placeholder: "https://example.com" } });
		const label = this.contentEl.createEl("input", { type: "text", cls: "kb-url-input", attr: { placeholder: "Link text (optional)" } });
		const row = this.contentEl.createDiv("kb-task-footer");
		const ok = row.createEl("button", { text: "Insert", cls: "mod-cta" });
		const cancel = row.createEl("button", { text: "Cancel" });
		const submit = (): void => {
			let u = url.value.trim();
			if (!u) { new Notice("Enter a web address."); return; }
			if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
			this.onSubmit(u.replace(/\)/g, "%29").replace(/\s/g, "%20"), label.value.trim());
			this.close();
		};
		ok.onclick = submit;
		cancel.onclick = () => this.close();
		this.contentEl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
		window.setTimeout(() => url.focus(), 0);
	}
	onClose(): void { this.contentEl.empty(); }
}

export class PromptModal extends Modal {
	constructor(app: App, private heading: string, private placeholder: string, private label: string, private onSubmit: (value: string) => void, private initial = "") {
		super(app);
	}
	onOpen(): void {
		this.titleEl.setText(this.heading);
		const input = this.contentEl.createEl("input", { type: "text", cls: "kb-url-input", attr: { placeholder: this.placeholder } });
		input.value = this.initial;
		const row = this.contentEl.createDiv("kb-task-footer");
		const ok = row.createEl("button", { text: this.label, cls: "mod-cta" });
		const cancel = row.createEl("button", { text: "Cancel" });
		const submit = (): void => {
			this.onSubmit(input.value.trim());
			this.close();
		};
		ok.onclick = submit;
		cancel.onclick = () => this.close();
		input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
		window.setTimeout(() => { input.focus(); input.select(); }, 0);
	}
	onClose(): void { this.contentEl.empty(); }
}

export class ArchiveModal extends Modal {
	constructor(
		app: App,
		private getCards: () => Card[],
		private onRestore: (c: Card) => void,
		private onDelete: (c: Card) => void,
		private onClear: () => void,
	) {
		super(app);
	}
	onOpen(): void { this.titleEl.setText("Archive"); this.draw(); }
	private draw(): void {
		const el = this.contentEl;
		el.empty();
		const cards = this.getCards();
		if (!cards.length) { el.createEl("p", { cls: "kb-hint", text: "Nothing archived." }); return; }
		const list = el.createDiv("kb-archive-list");
		for (const c of cards) {
			const row = list.createDiv("kb-archive-row");
			row.createSpan({ cls: "kb-archive-title", text: parseCard(c.text).title || "Untitled" });
			const restore = row.createEl("button", { text: "Restore" });
			restore.onclick = () => { this.onRestore(c); this.draw(); };
			const del = row.createEl("button", { text: "Delete", cls: "mod-warning" });
			del.onclick = () => { this.onDelete(c); this.draw(); };
		}
		const footer = el.createDiv("kb-task-footer");
		const clear = footer.createEl("button", { text: "Delete all", cls: "mod-warning" });
		clear.onclick = () => { this.onClear(); this.draw(); };
	}
	onClose(): void { this.contentEl.empty(); }
}
