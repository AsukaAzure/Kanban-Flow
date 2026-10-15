import { App, PluginSettingTab, Setting } from "obsidian";
import type KanbanFlowPlugin from "./main";
import type { Sub } from "./parser";

export interface TaskTemplate { id: string; name: string; text: string; desc: string; subs: Sub[] }

export interface KanbanSettings {
	defaultLists: string;
	dateFormat: string;
	timeFormat: "12h" | "24h";
	relativeDates: boolean;
	showDate: boolean;
	showTags: boolean;
	showContext: boolean;
	newCardPosition: "top" | "bottom";
	laneWidth: number;
	openLinksInNewTab: boolean;
	autoOpenBoards: boolean;
	confirmDelete: boolean;
	doneList: string;
	weekStart: "monday" | "sunday";
	reminders: boolean;
	reminderLead: number;
	notified: string[];
	tagColors: Record<string, string>;
	templates: TaskTemplate[];
}

export const DEFAULT_SETTINGS: KanbanSettings = {
	defaultLists: "To do, Doing, Done",
	dateFormat: "MMM D",
	timeFormat: "12h",
	relativeDates: true,
	showDate: true,
	showTags: true,
	showContext: true,
	newCardPosition: "bottom",
	laneWidth: 300,
	openLinksInNewTab: false,
	autoOpenBoards: true,
	confirmDelete: true,
	doneList: "Done",
	weekStart: "monday",
	reminders: true,
	reminderLead: 0,
	notified: [],
	tagColors: {},
	templates: [],
};

export class KanbanSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: KanbanFlowPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		const s = this.plugin.settings;
		containerEl.empty();
		const save = async (): Promise<void> => { await this.plugin.saveSettings(); };

		new Setting(containerEl).setName("New boards").setHeading();

		new Setting(containerEl)
			.setName("Default lists")
			.setDesc("Comma-separated list names created in every new board.")
			.addText((t) => t.setPlaceholder("To do, doing, done").setValue(s.defaultLists).onChange(async (v) => { s.defaultLists = v; await save(); }));

		new Setting(containerEl)
			.setName("Open board notes as boards")
			.setDesc("Notes with the kanban-plugin frontmatter open in the board view automatically. You can always switch back to markdown from the view's menu.")
			.addToggle((t) => t.setValue(s.autoOpenBoards).onChange(async (v) => { s.autoOpenBoards = v; await save(); }));

		new Setting(containerEl)
			.setName("Done list name")
			.setDesc("Moving a repeating task into this list schedules its next occurrence. Cards here are never shown as overdue.")
			.addText((t) => t.setPlaceholder("Done").setValue(s.doneList).onChange(async (v) => { s.doneList = v.trim() || "Done"; await save(); }));

		new Setting(containerEl).setName("Reminders").setHeading();

		new Setting(containerEl)
			.setName("Remind me when a task is due")
			.setDesc("Shows a notice for tasks that have a time. Only works while Obsidian is open.")
			.addToggle((t) => t.setValue(s.reminders).onChange(async (v) => { s.reminders = v; await save(); }));

		new Setting(containerEl)
			.setName("Remind before")
			.addDropdown((d) => d
				.addOption("0", "At the due time").addOption("5", "5 minutes before").addOption("15", "15 minutes before")
				.addOption("30", "30 minutes before").addOption("60", "1 hour before")
				.setValue(String(s.reminderLead))
				.onChange(async (v) => { s.reminderLead = +v; await save(); }));

		new Setting(containerEl).setName("Calendar").setHeading();

		new Setting(containerEl)
			.setName("Week starts on")
			.addDropdown((d) => d.addOption("monday", "Monday").addOption("sunday", "Sunday").setValue(s.weekStart)
				.onChange(async (v) => { s.weekStart = v as "monday" | "sunday"; await save(); }));

		new Setting(containerEl).setName("Cards").setHeading();

		new Setting(containerEl)
			.setName("Add new cards to")
			.addDropdown((d) => d.addOption("bottom", "Bottom of the list").addOption("top", "Top of the list").setValue(s.newCardPosition)
				.onChange(async (v) => { s.newCardPosition = v as "top" | "bottom"; await save(); }));

		new Setting(containerEl)
			.setName("Date format")
			.setDesc("How due dates are shown on cards.")
			.addDropdown((d) => d
				.addOption("MMM D", "Oct 9")
				.addOption("ddd, MMM D", "Fri, Oct 9")
				.addOption("DD/MM/YYYY", "09/10/2026")
				.addOption("MM/DD/YYYY", "10/09/2026")
				.addOption("YYYY-MM-DD", "2026-10-09")
				.setValue(s.dateFormat)
				.onChange(async (v) => { s.dateFormat = v; await save(); }));

		new Setting(containerEl)
			.setName("Time format")
			.addDropdown((d) => d.addOption("12h", "12-hour (3:00 PM)").addOption("24h", "24-hour (15:00)").setValue(s.timeFormat)
				.onChange(async (v) => { s.timeFormat = v as "12h" | "24h"; await save(); }));

		new Setting(containerEl)
			.setName("Relative dates")
			.setDesc("Show today, tomorrow and yesterday instead of the formatted date.")
			.addToggle((t) => t.setValue(s.relativeDates).onChange(async (v) => { s.relativeDates = v; await save(); }));

		new Setting(containerEl).setName("Show on cards").setHeading();
		new Setting(containerEl).setName("Due date and time")
			.addToggle((t) => t.setValue(s.showDate).onChange(async (v) => { s.showDate = v; await save(); }));
		new Setting(containerEl).setName("Tags")
			.addToggle((t) => t.setValue(s.showTags).onChange(async (v) => { s.showTags = v; await save(); }));
		new Setting(containerEl).setName("Contexts")
			.setDesc("Words starting with @, like @home.")
			.addToggle((t) => t.setValue(s.showContext).onChange(async (v) => { s.showContext = v; await save(); }));

		new Setting(containerEl).setName("Board").setHeading();

		new Setting(containerEl)
			.setName("List width")
			.addSlider((sl) => sl.setLimits(220, 480, 10).setValue(s.laneWidth).setDynamicTooltip()
				.onChange(async (v) => { s.laneWidth = v; await save(); }));

		new Setting(containerEl)
			.setName("Open links in a new tab")
			.setDesc("Applies to links to other notes inside cards.")
			.addToggle((t) => t.setValue(s.openLinksInNewTab).onChange(async (v) => { s.openLinksInNewTab = v; await save(); }));

		new Setting(containerEl)
			.setName("Confirm before deleting")
			.setDesc("Ask before deleting a list that contains cards.")
			.addToggle((t) => t.setValue(s.confirmDelete).onChange(async (v) => { s.confirmDelete = v; await save(); }));

		new Setting(containerEl).setName("Tag colours").setHeading();

		let newTag = "";
		let newColor = "#8b6cef";
		new Setting(containerEl)
			.setName("Add a tag colour")
			.setDesc("Type the tag name without the #. Tags without a colour use the default style.")
			.addText((t) => t.setPlaceholder("errands").onChange((v) => { newTag = v.replace(/^#/, "").trim().toLowerCase(); }))
			.addColorPicker((c) => c.setValue(newColor).onChange((v) => { newColor = v; }))
			.addButton((b) => b.setButtonText("Add").onClick(async () => {
				if (!newTag) return;
				s.tagColors[newTag] = newColor;
				await save();
				this.display();
			}));
		for (const [tag, color] of Object.entries(s.tagColors).sort()) {
			new Setting(containerEl)
				.setName(`#${tag}`)
				.addColorPicker((c) => c.setValue(color).onChange(async (v) => { s.tagColors[tag] = v; await save(); }))
				.addExtraButton((b) => b.setIcon("trash").setTooltip("Remove").onClick(async () => {
					delete s.tagColors[tag];
					await save();
					this.display();
				}));
		}

		new Setting(containerEl).setName("Task templates").setHeading();
		if (!s.templates.length) {
			containerEl.createEl("p", { cls: "setting-item-description", text: "No templates yet. In the task dialog, use the bookmark button to save the current task as a template." });
		}
		for (const t of s.templates) {
			const parts = [t.subs.length ? `${t.subs.length} subtasks` : "", t.desc ? "notes" : ""].filter(Boolean).join(", ");
			new Setting(containerEl)
				.setName(t.name)
				.setDesc(`${t.text}${parts ? ` (${parts})` : ""}`)
				.addExtraButton((b) => b.setIcon("trash").setTooltip("Delete template").onClick(async () => {
					s.templates = s.templates.filter((x) => x.id !== t.id);
					await save();
					this.display();
				}));
		}
	}
}
