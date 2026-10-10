# Examples

Every kind of block Grimm can show, on one page. Press **⌘/** to see the Markdown behind any of them, and change whatever you like: this is your copy.

## Text

A plain paragraph. Inside it you can have **bold**, *italic*, ~~strikethrough~~, `inline code` and [a link](https://github.com/deecaulcrick/grimm-md).

## Headings

# Heading 1

## Heading 2

### Heading 3

#### Heading 4

##### Heading 5

###### Heading 6

## Lists

A bullet list, with a second level:

- Bread
- Cheese
  - Something sharp
  - Something soft
- Olives

A numbered list:

1. Boil the water
2. Add the pasta
3. Taste before the timer says so

A checklist:

- [x] Write the first draft
- [ ] Cut it in half
- [ ] Sleep on it

## Quote

> Write it down before it becomes a feeling you can't name.

## Divider

Three dashes on their own line draw a rule:

---

## Code block

```js
// Syntax is highlighted for the language you pick.
function greet(name) {
  return `Hello, ${name}.`;
}
```

## Table

Columns can be aligned left, centre or right. Hover the table to add, move or delete rows and columns.

| Day | Where | Budget |
| :-- | :-: | --: |
| Friday | Alfama | 40 |
| Saturday | Belém | 55 |
| Sunday | Home | 0 |

## Image

Add one from the insert menu by pasting its web address, or with **Upload** to pick a picture from your Mac. An uploaded picture is copied into an `assets` folder beside the note. Hover it and drag the bar along its bottom edge to resize it, or use the button in its corner to add a caption. This one is loaded from the web, so it needs a connection.

![0.40](https://raw.githubusercontent.com/deecaulcrick/grimm-md/main/app-icon.png "The Grimm icon")

## Link card

A web address alone on a line becomes a card. Grimm needs to be online to fetch the preview.

https://github.com/deecaulcrick/grimm-md

## HTML embed

A code block with the language `embed` runs as live HTML:

```embed
<style>
  body { margin: 0; height: 150px; display: grid; place-items: center; background: #0A3630; color: #F8E347; font: 600 20px -apple-system, sans-serif; }
  span { animation: bob 2.4s ease-in-out infinite alternate; }
  @keyframes bob { to { transform: translateY(-10px); } }
</style>
<span>Live HTML, right in the page</span>
```
