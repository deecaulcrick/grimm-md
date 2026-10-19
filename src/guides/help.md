# Help

Short answers to the things people ask first. This page is always one click away: use the **Help** button at the bottom of the sidebar, or the **Help** menu at the top of the screen.

Three other notes come with Grimm, all in the **Help** menu:

- **Welcome to Grimm** is a five-minute tour.
- **Features** lists everything the app can do.
- **Examples** shows every kind of block, rendered, for you to poke at.

## Files

**Where are my notes kept?** Wherever you save them. Grimm edits ordinary `.md` files and keeps no library of its own.

**Do I need to save?** Only once. A new note lives in its tab until you save it with ⌘S and choose where it goes. From then on Grimm saves it for you a moment after you stop typing, and again when you close it or switch away from the app.

**How do I work with a whole folder?** Press ⇧⌘O and pick it. Its Markdown files appear in the sidebar, including those in subfolders. You can open several, or make a new one, with the **+** beside *Folders*. Click a folder to fold or unfold it; hover it for **+** to start a note inside and **…** for more, including *Remove from sidebar*.

**How do I rename a note?** Double-click its name in the note's header, or use *Rename* in its **…** menu or its sidebar row's **…**. The file on disk is renamed; its star, settings and shared link stay with it.

**How do I move a note to another folder?** Drag it onto a folder in the sidebar, or use *Move to…* in its **…** menu. Images it uses are copied into the new folder's `assets` and its links updated; the originals stay where they were, since other notes may use them.

**How do I know a note is unsaved?** Its tab shows a dot, and the note's header says *Edited just now*. For a note that has a file, the dot clears by itself within a second or two. Grimm asks before closing a new note that has never been saved.

**Where do uploaded images go?** Into a folder called `assets`, next to the note. The note links to them by a relative path, so keep the folder with the note when you move it. A new note has to be saved before a picture can be uploaded into it, and Grimm asks you to do that first.

**Will my tabs come back next time?** Yes, for notes that have been saved to a file. Unsaved, untitled notes are not kept.

## Writing

| To get | Type |
| --- | --- |
| A heading | `#` then a space (`##`, `###` for smaller ones) |
| Bold, italic | `**bold**`, `*italic*` |
| Inline code | `` `code` `` |
| A bullet list | `-` then a space |
| A numbered list | `1.` then a space |
| A checkbox | `[]` then a space |
| A quote | `>` then a space |
| A divider | `---` |
| A code block | ` ``` ` then Enter |
| Anything else | `/` on an empty line |

**How do I leave a list?** Press Enter on an empty item.

**How do I make a link?** Select the text and choose the link button in the toolbar that appears. A web address on a line of its own becomes a preview card instead.

**How do I add a table?** Type `/` and choose Table. Press Tab to move between cells. Hover a row or column to add, move, align or delete it.

**How do I see the raw Markdown?** Press ⌘/, and again to come back.

## Moving things

**How do I move a paragraph?** Hover it, then drag the six-dot grip that appears on its left. The same grip moves headings, quotes and list items.

**I moved something by mistake.** Press ⌘Z.

**How do I put two notes side by side?** Press ⇧⌘\, or click the split icon at the top right. Drag a tab, or a file from the sidebar, into either side.

## Appearance

**How do I change the theme?** Click the palette icon at the bottom of the sidebar. The theme applies to every note.

**How do I change a note's font or text size?** Click **…** in the note's header; the font, text size and width are at the top of that menu. Each note keeps its own.

**Can the text run the full width of the window?** Yes. In the same menu, turn on *Full width*.

**How do I colour or highlight text?** Select it and click the **A** in the menu that appears. Pick an ink for the text, a highlighter colour, or both.

## Troubleshooting

**macOS will not open Grimm.** The app is not notarised by Apple. Open **System Settings → Privacy & Security** and choose **Open Anyway**.

**A link card shows only the address.** Grimm could not reach the page, or the page gives no preview. Check your connection; the link itself still works.

**How do I update?** Grimm checks when it starts and offers to install a new version. To check yourself, use **Grimm → Check for Updates…**

## Something else?

Report a problem or suggest an idea on [the project's issue page](https://github.com/deecaulcrick/grimm-md/issues).
