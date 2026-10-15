import { App, Modal, moment } from "obsidian";
import { Card, Lane, LogEntry, parseCard } from "./parser";
import type { KanbanSettings } from "./settings";
import { applyTagColor, formatDue, isOverdue } from "./utils";

export interface DetailOptions {
	lane: Lane;
	card: Card;
	done: boolean;
	settings: KanbanSettings;
	renderText: (el: HTMLElement, text: string) => void;
	onEdit: () => void;
	onToggleSub: (index: number, done: boolean) => void;
}

/** Full detail page for one task: all fields, notes, subtasks, linked tasks and history. */
export class TaskDetailModal extends Modal {
	constructor(app: App, private o: DetailOptions) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass("kb-detail-modal");
		// Following a link inside the page closes it.
		this.contentEl.addEventListener("click", (e) => {
			if ((e.target as HTMLElement).closest("a")) window.setTimeout(() => this.close(), 0);
		}, true);
		this.draw();
	}

	onClose(): void { this.contentEl.empty(); }

	private stamp(ts: string): string {
		const fmt = this.o.settings.timeFormat === "12h" ? "h:mm A" : "HH:mm";
		return moment(ts, "YYYY-MM-DDTHH:mm").format(`MMM D, YYYY ${fmt}`);
	}

	private describe(e: LogEntry): string {
		switch (e.type) {
			case "created": return `Created in ${e.to ?? "a list"}`;
			case "moved": return `Moved from ${e.from ?? "?"} to ${e.to ?? "?"}`;
			case "archived": return `Archived from ${e.from ?? "a list"}`;
			default: return `Restored to ${e.to ?? "a list"}`;
		}
	}

	private draw(): void {
		const { lane, card, done, settings: s, renderText } = this.o;
		const info = parseCard(card.text);
		const el = this.contentEl;
		el.empty();

		renderText(el.createDiv("kb-detail-title"), info.title || "Untitled");

		const rows = el.createDiv("kb-detail-rows");
		const row = (label: string, fill: (v: HTMLElement) => void): void => {
			const r = rows.createDiv("kb-detail-row");
			r.createSpan({ cls: "kb-meta-label", text: label });
			fill(r.createDiv("kb-detail-value"));
		};
		row("List", (v) => v.setText(lane.title));
		for (let i = card.log.length - 1; i >= 0; i--) {
			const e = card.log[i];
			if ((e.type === "created" || e.type === "moved" || e.type === "restored") && e.to === lane.title) {
				row("In list since", (v) => v.setText(this.stamp(e.ts)));
				break;
			}
		}
		if (info.date) {
			const overdue = !done && isOverdue(info);
			row("Due", (v) => {
				v.setText(formatDue(info.date as string, info.time, s) + (overdue ? " (overdue)" : ""));
				if (overdue) v.addClass("is-overdue");
			});
		}
		if (info.priority) row("Priority", (v) => v.setText(info.priority as string));
		if (info.repeat) row("Repeat", (v) => v.setText(info.repeat as string));
		if (info.tags.length) row("Tags", (v) => info.tags.forEach((t) => applyTagColor(v.createSpan({ cls: "kb-tag", text: t }), t, s)));
		if (info.contexts.length) row("Context", (v) => info.contexts.forEach((c) => v.createSpan({ cls: "kb-context", text: c })));

		if (card.desc) {
			const sec = this.section("Notes");
			const body = sec.createDiv("kb-detail-notes");
			card.desc.split("\n").forEach((line) => renderText(body.createDiv(), line));
		}

		if (card.subs.length) {
			const doneN = card.subs.filter((x) => x.done).length;
			const sec = this.section(`Subtasks  ${doneN}/${card.subs.length}`);
			card.subs.forEach((sub, i) => {
				const item = sec.createEl("label", { cls: sub.done ? ["kb-sub-item", "is-done"] : ["kb-sub-item"] });
				const cb = item.createEl("input", { type: "checkbox" });
				cb.checked = sub.done;
				cb.onchange = () => { this.o.onToggleSub(i, cb.checked); this.draw(); };
				renderText(item.createSpan({ cls: "kb-sub-text" }), sub.text);
			});
		}

		const links: string[] = [];
		const re = /\[\[[^\]|]*#\^[^\]|]+(?:\|[^\]]*)?\]\]/g;
		for (const src of [card.text, card.desc]) for (const m of src.matchAll(re)) links.push(m[0]);
		if (links.length) {
			const sec = this.section("Linked tasks");
			for (const l of links) renderText(sec.createDiv("kb-detail-link"), l);
		}

		const hist = this.section("History");
		if (!card.log.length) {
			hist.createDiv({ cls: "kb-hint", text: "Nothing recorded yet. Moves between lists will appear here from now on." });
		} else {
			for (const e of [...card.log].reverse()) {
				const r = hist.createDiv("kb-detail-event");
				r.createSpan({ cls: "kb-detail-event-text", text: this.describe(e) });
				r.createSpan({ cls: "kb-detail-event-time", text: this.stamp(e.ts) });
			}
		}

		const footer = el.createDiv("kb-task-footer");
		const edit = footer.createEl("button", { text: "Edit", cls: "mod-cta" });
		edit.onclick = () => { this.close(); this.o.onEdit(); };
		const close = footer.createEl("button", { text: "Close" });
		close.onclick = () => this.close();
	}

	private section(title: string): HTMLElement {
		const sec = this.contentEl.createDiv("kb-detail-section");
		sec.createDiv({ cls: "kb-detail-h", text: title });
		return sec;
	}
}
