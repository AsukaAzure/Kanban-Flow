import { setIcon } from "obsidian";
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
