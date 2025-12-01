# Live Request Editor Content Parts

Power users sometimes dive into the raw prompt that Copilot assembles. The Live Request Editor inside VS Code exposes each ChatML segment exactly as it will be sent to the LLM. This document explains the content-part kinds you may encounter so you can interpret or tweak the prompt confidently.

## Overview

Each chat message is composed of one or more `ChatCompletionContentPart` entries (from `@vscode/prompt-tsx`). The editor renders them in order. When a part is not plain text, the UI shows a structured placeholder (for example, `<cacheBreakpoint type="…" />`). Use the mapping below to understand what each placeholder means and how safe it is to edit.

## Part Types

| Kind | Visual Treatment | Meaning | Editing Guidance |
| --- | --- | --- | --- |
| `Text` | The exact Markdown/text appears inline. | Plain instructions, user input, or tool output. | Safe to edit directly. |
| `Image` | `![image](…)` with a data/URL reference. | Vision inputs or inline screenshots. | Editing text has no effect; delete to drop the image from the request. |
| `CacheBreakpoint` | `<cacheBreakpoint type="…" />` | Marks where the host can reuse cached prompt context (Anthropic/Claude, etc.). | Leave intact. Removing may disable caching; moving can break parity with logged prompts. |
| `Opaque` | `<opaquePart … />` or <code>`[opaque {…}]`</code> depending on metadata. | Binary or structured payloads (attachments, references, reminder instructions). | Keep the tag but you can adjust adjacent text. Delete only if you intend to drop the entire attachment/reference. |

### Opaque Part Metadata

Opaque payloads often carry these fields:

- `type` – e.g., `attachment`, `reference`, `reminderInstructions`.
- `id` / `referenceId` / `attachmentId` – stable identifier used to match edits.
- `label` / `name` – human-readable label shown in the UI.

When editing, prefer removing the whole opaque part instead of hand-editing JSON; it will be regenerated from the backing service on the next turn.

## Tips for Advanced Editing

1. **Preserve structural tags** – Keep `<cacheBreakpoint …/>` and `<opaquePart …/>` tags in place unless you intend to remove the referenced resource entirely.
2. **Annotate edits** – When you need to override instructions, add clarifying text *after* the existing system/user blocks so it’s obvious to other collaborators (and to yourself later).
3. **Reset when in doubt** – If the prompt shows unexpected placeholders after heavy edits, use the Live Request Editor’s “Reset” action to regenerate the sections from the original conversation state.
4. **Attachments vs. text** – If you need to refer to a file inline, keep the `<opaquePart type="attachment" …/>` (which streams the file) and add commentary in the surrounding text rather than duplicating file contents manually.

## References

- Source transformation: `src/extension/prompt/node/liveRequestBuilder.ts`
- Enum definition: `node_modules/@vscode/prompt-tsx/dist/base/output/rawTypes.d.ts`

Update this document as new content kinds appear in upstream Copilot contracts.

