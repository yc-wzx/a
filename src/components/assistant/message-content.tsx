import type { ReactNode } from "react";

function inline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith("**") ? <strong key={index}>{part.slice(2, -2)}</strong> : part);
}

export function AssistantMessageContent({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.trim().startsWith("```")) {
      const code: string[] = [];
      while (index + 1 < lines.length && !lines[index + 1].trim().startsWith("```")) code.push(lines[++index]);
      if (index + 1 < lines.length) index++;
      blocks.push(<pre key={index} className="my-3 overflow-auto rounded bg-sunken p-3 text-xs"><code>{code.join("\n")}</code></pre>);
    } else if (/^\s*\|/.test(line) && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1] ?? "")) {
      const rows = [line]; index++;
      while (index + 1 < lines.length && /^\s*\|/.test(lines[index + 1])) rows.push(lines[++index]);
      blocks.push(<div key={index} className="my-3 overflow-x-auto"><table className="w-full border-collapse text-left text-sm"><tbody>{rows.map((row, rowIndex) =>
        <tr key={rowIndex}>{row.replace(/^\s*\||\|\s*$/g, "").split("|").map((cell, cellIndex) => rowIndex === 0
          ? <th key={cellIndex} className="border border-line bg-sunken px-3 py-2 font-medium">{inline(cell.trim())}</th>
          : <td key={cellIndex} className="border border-line px-3 py-2">{inline(cell.trim())}</td>)}</tr>,
      )}</tbody></table></div>);
    } else if (/^#{1,3}\s+/.test(line)) {
      blocks.push(<h3 key={index} className="mb-2 mt-4 text-base font-semibold">{inline(line.replace(/^#{1,3}\s+/, ""))}</h3>);
    } else if (/^\s*[-*+]\s+/.test(line)) {
      blocks.push(<p key={index} className="flex gap-2"><span aria-hidden>•</span><span>{inline(line.replace(/^\s*[-*+]\s+/, ""))}</span></p>);
    } else {
      blocks.push(line ? <p key={index} className="whitespace-pre-wrap break-words">{inline(line)}</p> : <br key={index} />);
    }
  }
  return <div className="text-sm leading-7">{blocks}</div>;
}
