import sanitize from "sanitize-html";
import { convert } from "html-to-text";
export function cleanHTML(value) {
  return sanitize(String(value || "").slice(0, 50000), {
    allowedTags: [
      "p",
      "br",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "s",
      "ul",
      "ol",
      "li",
      "blockquote",
      "pre",
      "code",
      "a",
    ],
    allowedAttributes: { a: ["href", "title", "rel", "target"] },
    allowedSchemes: ["https", "http", "mailto"],
    allowProtocolRelative: false,
    transformTags: {
      a: sanitize.simpleTransform("a", {
        rel: "noopener noreferrer",
        target: "_blank",
      }),
    },
  });
}
export function plainHTML(value) {
  return convert(cleanHTML(value), { wordwrap: false }).trim().slice(0, 10000);
}
