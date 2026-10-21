"use client";
import { useState, type RefObject } from "react";
import Link from "next/link";
import type { DocumentCollaboration } from "@/contracts/document-collaboration";
import { documentCommentMentions } from "@/contracts/document-collaboration";
type Member = DocumentCollaboration["members"][number];
function label(member: Member, members: Member[]) { const name = member.name.replace(/[\]\r\n]/g, "_").slice(0, 90); return members.filter(m => m.name === member.name).length > 1 ? name + "·" + member.id.slice(0, 4) : name; }
export function CommentMentionInput({ value, onChange, members, inputRef, placeholder }: { value: string; onChange: (value: string) => void; members: Member[]; inputRef: RefObject<HTMLTextAreaElement | null>; placeholder: string }) {
  const [open, setOpen] = useState(false); const [query, setQuery] = useState("");
  const tokens = documentCommentMentions(value);
  let display = value;
  for (const token of tokens) { const member = members.find(m => m.id === token.id); display = display.replaceAll(token.token, "@" + (member ? label(member, members) : token.name)); }
  function encode(text: string) { let next = text; for (const token of tokens) { const member = members.find(m => m.id === token.id); next = next.replaceAll("@" + (member ? label(member, members) : token.name), token.token); } return next; }
  return <div className="document-comment-mention-input"><textarea ref={inputRef} aria-label="评论内容" required maxLength={3000} value={display} onChange={e => { const text = e.target.value; onChange(encode(text)); const prefix = text.slice(0, e.target.selectionStart); const match = /@([^@\s]{0,80})$/u.exec(prefix); setOpen(!!match); setQuery(match?.[1] ?? ""); }} placeholder={placeholder} className="mt-1 min-h-24 w-full rounded-lg border border-line bg-surface p-2 text-sm" onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } }} /><button type="button" className="text-xs text-primary" aria-expanded={open} onClick={() => { setOpen(v => !v); setQuery(""); }}>@ 提醒成员</button>{open && <div className="document-comment-member-menu" aria-label="评论提及成员">{members.filter(m => m.name.includes(query)).map(member => <button type="button" key={member.id} className="block w-full rounded p-2 text-left text-xs hover:bg-primary-soft" onClick={() => {
      const caret = inputRef.current?.selectionStart ?? display.length; const before = display.slice(0, caret).replace(/@[^@\s]*$/u, ""); const text = before + "@" + label(member, members) + " " + display.slice(caret);
      const withExisting = encode(text); onChange(withExisting.replace("@" + label(member, members), `@[${label(member, members)}](member:${member.id})`)); setOpen(false); requestAnimationFrame(() => inputRef.current?.focus());
    }}>{label(member, members)}<span className="ml-2 text-ink-faint">{member.permission === "edit" ? "可编辑" : member.permission === "comment" ? "可评论" : "可阅读"}</span></button>)}{!members.some(m => m.name.includes(query)) && <p className="p-2 text-xs text-ink-faint">暂无可提及成员</p>}<p className="border-t border-line p-2 text-[11px] text-ink-faint">仅提醒已有文档权限的成员</p></div>}</div>;
}
export function CommentMentionBody({ body, members }: { body: string; members: Member[] }) {
  const tokens = documentCommentMentions(body); let cursor = 0; const parts: React.ReactNode[] = [];
  for (const [index, token] of tokens.entries()) { const at = body.indexOf(token.token, cursor); parts.push(body.slice(cursor, at)); const member = members.find(m => m.id === token.id); parts.push(member ? <Link key={index} href={`/people/${member.id}`} className="text-primary hover:underline">@{member.name}</Link> : <span key={index} className="text-ink-soft">@成员不可用</span>); cursor = at + token.token.length; }
  parts.push(body.slice(cursor)); return <>{parts}</>;
}
