import { useEffect, useRef } from "react";
import DOMPurify from "dompurify";
export function RichBody({ html }: { html: string }) {
  return (
    <div
      className="text-sm break-words [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 [&_ol]:pl-6 [&_a]:text-blue-700 [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:pl-3 [&_pre]:whitespace-pre-wrap"
      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
    />
  );
}
export default function RichComposer({
  value,
  onChange,
}: {
  value: string;
  onChange: (text: string, html: string) => void;
}) {
  const editor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (editor.current && editor.current.innerText !== value)
      editor.current.textContent = value;
  }, [value]);
  const capture = () => {
    if (editor.current)
      onChange(
        editor.current.innerText,
        DOMPurify.sanitize(editor.current.innerHTML),
      );
  };
  const command = (name: string) => {
    editor.current?.focus();
    document.execCommand(name);
    capture();
  };
  return (
    <div className="rounded-lg border bg-white overflow-hidden">
      <div
        className="flex gap-1 p-2 border-b bg-slate-50"
        role="toolbar"
        aria-label="Reply formatting"
      >
        {[
          ["bold", "Bold"],
          ["italic", "Italic"],
          ["underline", "Underline"],
          ["insertUnorderedList", "Bullet list"],
          ["insertOrderedList", "Numbered list"],
          ["removeFormat", "Clear formatting"],
        ].map(([name, label]) => (
          <button
            key={name}
            type="button"
            className="px-2 py-1 text-xs rounded hover:bg-slate-200"
            aria-label={label}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => command(name)}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        ref={editor}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-label="Formatted reply"
        aria-multiline="true"
        className="min-h-32 p-3 text-sm outline-none [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 [&_ol]:pl-6"
        onInput={capture}
        onPaste={(e) => {
          e.preventDefault();
          document.execCommand(
            "insertText",
            false,
            e.clipboardData.getData("text/plain"),
          );
          capture();
        }}
      />
    </div>
  );
}
