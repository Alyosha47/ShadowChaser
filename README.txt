index.html -> index.html   (BUILD 2026-08-08j)

TIDY ONLY. The rendered DOM is byte-identical to the previous version --
verified by parsing both, stripping comments and collapsing whitespace, and
comparing the serialised result. Nothing moved.

What changed:
- The t-shirt sheet block was at column 0 while everything around it is
  indented two spaces. Re-indented.
- Long prose lines wrapped at ~100 chars. Lines over 200 chars: 14 -> 6.
  The remaining six carry inline SVG icons and are left alone: wrapping them
  would put a newline inside a path d="..." attribute and change its value.
- Opening and closing <p> tags stay glued to the text, so no leading or
  trailing space is introduced -- HTML would collapse that to a real space and
  shift the paragraph.

What I did NOT change: comments (39 open, 39 close, all balanced -- the
"unterminated comment" I thought I saw was my own truncated terminal output),
structure, scripts, or any attribute.
