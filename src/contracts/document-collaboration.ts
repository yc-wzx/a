export type DocumentCollaboration = {
  members: { id: string; name: string; role: string; permission: string }[];
  tasks: { id: string; title: string; status: string; dueDate: string | null; assigneeName: string | null }[];
  attachments: { id: string; filename: string; mediaType: string; size: number }[];
};
export type DocumentMentionTarget = { from: number; to: number; query: string };
// Store stable member identities, including when two members have the same name.
export function documentCommentMentions(body: string) {
  return [...body.matchAll(/@\[([^\]\r\n]{1,100})\]\(member:([0-9a-f-]{36})\)/gi)].map(match => ({ name: match[1], id: match[2], token: match[0] }));
}
