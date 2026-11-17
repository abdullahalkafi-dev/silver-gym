import { test } from "node:test";
import assert from "node:assert/strict";

import { cleanRichText, richTextToPlain } from "./trainerPlan.richText";

test("keeps the editor's formatting tags", () => {
  const html =
    "<h2>Breakfast</h2><p><strong>Oats</strong> with <em>milk</em> and <u>banana</u></p><ul><li>2 eggs</li></ul><ol><li>Walk</li></ol>";
  assert.equal(cleanRichText(html), html);
});

test("removes scripts, event handlers, styles and links", () => {
  const dirty =
    '<p onclick="steal()" style="color:red">Hi<script>alert(1)</script></p><a href="https://evil.example">click</a><img src=x onerror=alert(1)>';
  assert.equal(cleanRichText(dirty), "<p>Hi</p>click");
});

test("maps other spellings to the allowed tags", () => {
  assert.equal(cleanRichText("<h1>A</h1><b>B</b><i>C</i><div>D</div>"), "<h2>A</h2><strong>B</strong><em>C</em><p>D</p>");
});

test("plain text ignores tags and blank paragraphs", () => {
  assert.equal(richTextToPlain("<p></p><p>&nbsp;</p>"), "");
  assert.equal(richTextToPlain("<h2>Day 1</h2><p>Squats</p>"), "Day 1Squats");
});
