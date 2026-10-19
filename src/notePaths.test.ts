import { describe, expect, it } from "vitest";
import {
  fileNameFor,
  isLocalRelative,
  localImageRefs,
  movedPath,
  nameProblem,
  remapKey,
  remapList,
  renamedPath,
  resolveRelative,
  rewriteImageRefs,
} from "./notePaths";

describe("names", () => {
  it("refuses names a file can't have", () => {
    expect(nameProblem("")).toBeTruthy();
    expect(nameProblem("   ")).toBeTruthy();
    expect(nameProblem("a/b")).toBeTruthy();
    expect(nameProblem("a:b")).toBeTruthy();
    expect(nameProblem(".hidden")).toBeTruthy();
    expect(nameProblem("x".repeat(201))).toBeTruthy();
    expect(nameProblem("Chapter 1 — the start")).toBeNull();
  });

  it("keeps the note's extension unless one is typed", () => {
    expect(fileNameFor("Chapter 1", "/n/old.md")).toBe("Chapter 1.md");
    expect(fileNameFor("  Chapter 1  ", "/n/old.markdown")).toBe("Chapter 1.markdown");
    expect(fileNameFor("notes.MD", "/n/old.md")).toBe("notes.MD");
    expect(fileNameFor("plain", "/n/noextension")).toBe("plain.md");
  });

  it("works out renamed and moved paths", () => {
    expect(renamedPath("/books/drafts/old.md", "New name")).toBe("/books/drafts/New name.md");
    expect(movedPath("/books/drafts/old.md", "/books/final")).toBe("/books/final/old.md");
    expect(movedPath("/books/drafts/old.md", "/books/final/")).toBe("/books/final/old.md");
  });
});

describe("remembered paths", () => {
  it("swaps a path in a list and keeps its place", () => {
    expect(remapList(["/a.md", "/b.md", "/c.md"], "/b.md", "/z.md")).toEqual(["/a.md", "/z.md", "/c.md"]);
    expect(remapList(["/a.md"], "/b.md", "/z.md")).toEqual(["/a.md"]);
  });

  it("moves a record's key and leaves others", () => {
    expect(remapKey({ "/a.md": 1, "/b.md": 2 }, "/a.md", "/z.md")).toEqual({ "/b.md": 2, "/z.md": 1 });
    const same = { "/a.md": 1 };
    expect(remapKey(same, "/x.md", "/z.md")).toBe(same);
  });
});

describe("images", () => {
  it("tells relative images from web and absolute ones", () => {
    expect(isLocalRelative("assets/cat.png")).toBe(true);
    expect(isLocalRelative("../pics/cat.png")).toBe(true);
    expect(isLocalRelative("https://example.com/cat.png")).toBe(false);
    expect(isLocalRelative("/Users/dee/cat.png")).toBe(false);
    expect(isLocalRelative("data:image/png;base64,xx")).toBe(false);
  });

  it("resolves an address against the note's folder", () => {
    expect(resolveRelative("/books/drafts", "assets/cat.png")).toBe("/books/drafts/assets/cat.png");
    expect(resolveRelative("/books/drafts", "../pics/My%20cat.png")).toBe("/books/pics/My cat.png");
    expect(resolveRelative("/books/drafts", "./a/./b.png")).toBe("/books/drafts/a/b.png");
  });

  const note = [
    "# Trip",
    "",
    "![cat](assets/cat.png) and ![dog](<assets/my dog.png> \"Rex\")",
    "![web](https://example.com/x.png) ![abs](/tmp/y.png)",
    '<img src="assets/old.jpg" width="200">',
    "Code: `![not](assets/code.png)`",
    "",
    "```md",
    "![also not](assets/fenced.png)",
    "```",
    "",
    "![cat again](assets/cat.png)",
    "",
  ].join("\n");

  it("finds each relative image once, outside code", () => {
    expect(localImageRefs(note)).toEqual(["assets/cat.png", "assets/my dog.png", "assets/old.jpg"]);
  });

  it("rewrites only the mapped images, outside code", () => {
    const out = rewriteImageRefs(note, {
      "assets/cat.png": "assets/cat-2.png",
      "assets/my dog.png": "assets/my dog.png",
      "assets/old.jpg": "pics/old.jpg",
    });
    expect(out).toContain("![cat](assets/cat-2.png)");
    expect(out).toContain("![cat again](assets/cat-2.png)");
    expect(out).toContain('![dog](<assets/my dog.png> "Rex")');
    expect(out).toContain('<img src="pics/old.jpg" width="200">');
    expect(out).toContain("`![not](assets/code.png)`");
    expect(out).toContain("![also not](assets/fenced.png)");
    expect(out).toContain("![web](https://example.com/x.png)");
    expect(out.split("\n").length).toBe(note.split("\n").length);
  });

  it("leaves a note without images exactly as it was", () => {
    const text = "Plain text\n\n- a list\n\n```\ncode\n```\n";
    expect(rewriteImageRefs(text, { "a.png": "b.png" })).toBe(text);
  });
});
