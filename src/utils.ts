import { moment, setIcon } from "obsidian";
import type { CardInfo } from "./parser";
import { todayISO } from "./parser";
import type { KanbanSettings } from "./settings";

/** Shows a tag in its chosen colour (soft background, coloured text). */
export function applyTagColor(el: HTMLElement, tag: string, s: KanbanSettings): void {
	const hex = s.tagColors[tag.toLowerCase()];
	if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return;
	const n = parseInt(hex.slice(1), 16);
	el.style.backgroundColor = `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, 0.22)`;
	el.style.color = hex;
}

/** Puts an icon in the element, or a text fallback if the icon name is unknown in this Obsidian version. */
export function iconText(el: HTMLElement, name: string, fallback: string): void {
	setIcon(el, name);
	if (!el.querySelector("svg")) el.setText(fallback);
}

export function iconButton(parent: HTMLElement, name: string, label: string, fallback: string, cls: string[] = ["kb-btn"]): HTMLButtonElement {
	const b = parent.createEl("button", { cls, attr: { "aria-label": label, title: label } });
	iconText(b, name, fallback);
	return b;
}

const nowHM = (): string => {
	const d = new Date();
	return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export function isOverdue(info: CardInfo): boolean {
	if (!info.date) return false;
	const t = todayISO();
	return info.date < t || (info.date === t && !!info.time && info.time < nowHM());
}

export function formatTime(time: string, s: KanbanSettings): string {
	return moment(time, "HH:mm").format(s.timeFormat === "12h" ? "h:mm A" : "HH:mm");
}

export function formatDue(date: string, time: string | undefined, s: KanbanSettings): string {
	const diff = moment(date, "YYYY-MM-DD").diff(moment().startOf("day"), "days");
	let label = moment(date, "YYYY-MM-DD").format(s.dateFormat);
	if (s.relativeDates) {
		if (diff === 0) label = "Today";
		else if (diff === 1) label = "Tomorrow";
		else if (diff === -1) label = "Yesterday";
	}
	return time ? `${label}, ${formatTime(time, s)}` : label;
}
