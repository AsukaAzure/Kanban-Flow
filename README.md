# Kanban Flow

Kanban boards for [Obsidian](https://obsidian.md) that live in plain markdown notes. Create your own lists, drag cards and lists around, and add tasks by typing naturally: `Call John tomorrow 3pm @phone #work !high`.

Works on desktop and mobile.

<!-- Add screenshots or a GIF here, e.g. ![Board view](docs/board.png) -->

## Features

- **Boards are just notes.** Everything is saved as markdown, so boards sync, search and version like any other file.
- **Your own lists.** Add, rename, reorder, sort, collapse, archive and delete lists. Set an optional card limit per list.
- **Drag and drop.** Move cards within and between lists, and drag a whole list by its header. On touch screens, press and hold briefly, then drag.
- **Natural-language quick entry.** Dates, times, priority, repeats, `#tags`, `@contexts` and links are picked up as you type.
- **Task details.** Multi-line notes and subtasks with a progress count. Tick subtasks directly on the card.
- **Filter and search.** Free text plus quick filters (overdue, today, this week, priority, any tag or context).
- **Calendar view.** All dated tasks on a month grid. Drag a task to another day to reschedule.
- **Repeating tasks.** Move a repeating card to your Done list and the next one is created for you.
- **Reminders.** A notice when a task with a time is due.
- **Undo and redo** for board changes.
- **Archive** cards or whole lists and restore them later.
- **Convert a card to a note**, keeping its tags and date and leaving a link behind.
- **Autocomplete** for `[[notes]]`, `#tags` and `@contexts` while typing.
- **Hover preview** for `[[note links]]` on cards.

## Installation

### From the community plugin list

Once the plugin is approved:

1. Open **Settings → Community plugins** and turn off Restricted mode.
2. Select **Browse**, search for **Kanban Flow**, then **Install** and **Enable**.

### Manual

1. Download `main.js`, `manifest.json` and `styles.css` from the latest [release](../../releases).
2. Copy them into `<your vault>/.obsidian/plugins/kanban-flow/`.
3. Reload Obsidian and enable **Kanban Flow** under **Settings → Community plugins**.

### With BRAT

Add this repository's URL in the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin to install and update before the plugin is in the community list.

Requires Obsidian 1.4.0 or newer.

## Getting started

Create a board in any of these ways:

- Open an **empty note**, type `/create-kanban` and press Enter.
- Run **Create kanban board in current note** from the command palette (empty note).
- Click the ribbon icon, or run **Create new kanban board**, to make a new board file.

New boards start with the lists from your settings (default: To do, Doing, Done). Notes that contain the `kanban-plugin: board` frontmatter open as boards automatically.

## Adding tasks

Press **New task** (or the `+` button) and type. The text box understands:

| You type | What happens |
| --- | --- |
| `tomorrow`, `today`, `day after tomorrow` | Sets the due date |
| `next friday`, `monday`, `next week`, `next month` | Sets the due date |
| `in 3 days`, `in 2 weeks`, `in 1 month` | Sets the due date |
| `oct 15`, `15 oct`, `2026-11-02` | Sets the due date |
| `3pm`, `3:15pm`, `15:30`, `noon`, `midnight` | Sets the time |
| `every day`, `every weekday`, `every monday`, `every 2 weeks` | Makes the task repeat |
| `!high`, `!medium`, `!low` | Sets the priority |
| `#errands` | Adds a tag (a category or topic) |
| `@home` | Adds a context (a place or tool) |
| `[[Note name]]` | Links to another note |
| `https://example.com` or `[text](https://example.com)` | Adds a web link |

Example: `Team sync every monday 10am #work @office !high`

Notes on parsing:

- A bare time such as `3:15` is read as **3:15 PM**. Write `03:15` for the morning, or `3:15am`.
- The date and time pickers fill in as you type. If you delete the words, the values they filled in are cleared again.
- The dialog also has a list picker, priority, repeat, a notes box and subtasks. Use the link icons to insert a note link or a web link.
- Type `[[` to search your notes, or `#` / `@` to reuse tags and contexts already on the board.

### Tags versus contexts

- **Tags (`#`)** describe what a task is about: `#work`, `#study`, `#errands`.
- **Contexts (`@`)** describe where or how you can do it: `@home`, `@office`, `@phone`.

Both show on the card and can be used to filter the board.

## Working with the board

- **Edit a task:** click the card. **More actions:** the `⋯` button (or right-click on desktop) gives priority, duplicate, convert to note, archive, move to another list and delete.
- **Lists:** double-click a title to rename it. The `⋯` menu on a list has collapse, card limit, sort by due date, move left or right, archive all cards and delete.
- **Card limit:** the count turns red when a list goes over its limit.
- **Filter:** type in the search bar (`#tag`, `@context`, `due:today`, `due:overdue`, `due:week`, `prio:high`, or plain text) or use the funnel icon for quick filters.
- **Calendar:** switch with the Board / Calendar buttons. Tasks without a date appear in a strip below the calendar and can be dragged onto a day.
- **Undo / redo:** the undo button, `Ctrl/Cmd + Z` and `Ctrl/Cmd + Shift + Z` while the board is focused, or the commands below.
- **Archive:** the archive button appears once something is archived. Restore or delete cards there.
- **Hover preview:** hold `Ctrl` (`Cmd` on Mac) and hover a note link on a card. Requires the core **Page preview** plugin. The modifier requirement can be changed under **Settings → Page preview → Kanban Flow**.
- **Open as markdown:** use the file icon in the view header to see the raw note, and the **Toggle between board and markdown view** command to switch back.

### Repeating tasks

Add a repeat to a task (for example `every monday`). When you move that card into your **Done list**, the card stays there as a record and a new copy with the next due date is added to your first list. The Done list is a setting (default name: `Done`). Cards in the Done list are never shown as overdue.

### Reminders

If a task has a time, a notice appears when it is due (or the chosen number of minutes before). Reminders only fire while Obsidian is open, and each one shows once. A reminder is identified by the note, task title, date and time, so editing other details of a card does not trigger it again.

## Commands

| Command | Description |
| --- | --- |
| Create new kanban board | Creates a new board note and opens it |
| Create kanban board in current note | Turns the current empty note into a board |
| Add task to current board | Opens the new task dialog |
| Undo last board change / Redo board change | Step back or forward through changes |
| Toggle between board and markdown view | Switches the current note between views |

Assign hotkeys to any of these under **Settings → Hotkeys**.

## Settings

| Setting | Description |
| --- | --- |
| Default lists | Comma-separated names used for new boards |
| Open board notes as boards | Open notes with the board frontmatter in the board view automatically |
| Done list name | The list that completes repeating tasks and hides overdue styling |
| Remind me when a task is due / Remind before | Turn reminders on and choose the lead time |
| Week starts on | Monday or Sunday in the calendar |
| Add new cards to | Top or bottom of a list |
| Date format, Time format, Relative dates | How due dates are displayed |
| Show on cards | Toggle due date, tags and contexts |
| List width | Width of lists on the board |
| Open links in a new tab | For note links inside cards |
| Confirm before deleting | Ask before deleting a list that has cards |

## Board file format

Boards are plain markdown:

```markdown
---
kanban-plugin: board
---

## To do
<!-- kanban: limit=3 collapsed=1 -->

- [ ] Buy groceries #errands @home ⏫ 📅 2026-10-11 ⏰ 15:00 🔁 every week
  Notes go on indented lines
  - [x] a subtask
  - [ ] another subtask

## Done

***

## Archive

- [x] An archived card
```

- Each `##` heading is a list, and each `- [ ]` line is a card.
- Indented lines under a card are its notes. Indented `- [ ]` lines are its subtasks.
- `📅` is the due date, `⏰` the time, `🔁` the repeat rule, and `⏫` / `🔼` / `🔽` the priority (high, medium, low). These match the icons used by the Tasks plugin.
- List options are stored in a `<!-- kanban: ... -->` comment under the list heading.
- Archived cards are stored after the `***` line under `## Archive`.

## Known limitations

- Only list headings (`##`), card lines and their indented details are kept. **Any other text in a board note is removed when the board is saved**, so keep extra writing in a separate note.
- Reminders need Obsidian to be running.
- Very large boards redraw completely after each change, which may feel slow with many hundreds of cards.

## Development

```bash
npm install
npm run dev      # rebuilds main.js when files change
npm run build    # type-check and production build
```

Copy `main.js`, `manifest.json` and `styles.css` into a test vault's `.obsidian/plugins/kanban-flow/` folder, then reload Obsidian. Source files live in `src/`:

- `parser.ts`: board file format and natural-language parsing
- `view.ts`: board and calendar views, drag and drop, menus
- `modals.ts`: task dialog, autocomplete and other dialogs
- `settings.ts`: settings and settings tab
- `main.ts`: plugin entry, commands, slash command and reminders

### Releasing

1. Update `version` in `manifest.json` and `package.json`, and add the version to `versions.json`.
2. Tag the commit with exactly the same version number (for example `1.0.0`) and push the tag.
3. The included GitHub workflow builds the plugin and attaches `main.js`, `manifest.json` and `styles.css` to the release.

## Support

Found a bug or have an idea? Open an [issue](../../issues) and include your Obsidian version, whether you are on desktop or mobile, and the steps to reproduce.

## License

[MIT](LICENSE)