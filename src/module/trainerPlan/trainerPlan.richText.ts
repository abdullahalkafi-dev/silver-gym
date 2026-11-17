import sanitizeHtml from "sanitize-html";

/**
 * Plans and templates are written in the portal's rich text editor (HTML).
 * Only these plain formatting tags survive, with no attributes at all, so a plan
 * can never carry scripts, styles, images or links.
 */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p",
    "br",
    "h2",
    "h3",
    "strong",
    "em",
    "u",
    "s",
    "ul",
    "ol",
    "li",
    "blockquote",
    "hr",
  ],
  allowedAttributes: {},
  // Same meaning, one spelling: keeps stored HTML predictable for every screen.
  transformTags: {
    b: "strong",
    i: "em",
    strike: "s",
    del: "s",
    h1: "h2",
    h4: "h3",
    h5: "h3",
    h6: "h3",
    div: "p",
  },
  // Drop the text inside these too, not just the tags.
  nonTextTags: ["script", "style", "textarea", "option", "noscript", "title", "head"],
};

export const cleanRichText = (html: string) => sanitizeHtml(html ?? "", OPTIONS).trim();

/** Visible text of cleaned HTML (used to reject a plan with no words in it). */
export const richTextToPlain = (html: string) =>
  sanitizeHtml(html ?? "", { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
