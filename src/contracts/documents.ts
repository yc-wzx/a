export type DocumentPermission = "read" | "comment" | "edit";
export type DocumentVisibility = "project" | "private";
export type DocumentNode = {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: DocumentNode[];
};
export type DocumentSummary = {
  id: string;
  projectId: string;
  title: string;
  folder: string;
  ownerId: string;
  ownerName: string;
  visibility: DocumentVisibility;
  defaultPermission: DocumentPermission;
  permission: DocumentPermission;
  canManage: boolean;
  canEdit: boolean;
  canComment: boolean;
  revision: number;
  epoch: number;
  updatedAt: string;
  deletedAt: string | null;
  excerpt: string;
};
export type DocumentGrant = { userId: string; name: string; permission: DocumentPermission };
export type DocumentTaskLink = { taskId: string; title: string; status: string; href: string };
export type DocumentComment = {
  id: string;
  replyToId: string | null;
  replyToAuthorName: string | null;
  blockId: string | null;
  quote: string;
  body: string;
  authorId: string;
  authorName: string;
  resolvedAt: string | null;
  createdAt: string;
  canDelete: boolean;
};
export type DocumentVersion = {
  id: string;
  label: string;
  authorName: string;
  createdAt: string;
  revision: number;
  kind: "manual" | "restore" | "checkpoint";
};
export type DocumentDetail = DocumentSummary & {
  content: DocumentNode;
  state: string;
  grants: DocumentGrant[];
  members: { id: string; name: string; role: string }[];
  tasks: { id: string; title: string; status: string }[];
  links: DocumentTaskLink[];
  comments: DocumentComment[];
  versions: DocumentVersion[];
  actorId: string;
  actorName: string;
};
export type DocumentList = { items: DocumentSummary[]; total: number; nextOffset: number | null };
export type DocumentPresence = { sessionId: string; userId: string; name: string; awareness: string | null };
export type DocumentSyncInput = {
  sessionId: string;
  epoch: number;
  stateVector?: string;
  update?: string;
  awareness?: string | null;
};
export type DocumentSyncResult = {
  update: string;
  epoch: number;
  revision: number;
  permission: DocumentPermission;
  updatedAt: string;
  presence: DocumentPresence[];
};

// HTTP responses use the existing Result<T> envelope. Identity is always from
// the session. Synchronization merges Yjs updates rather than replacing JSON.
// POST /api/projects/:projectId/documents {requestId,title,folder?,visibility?,content?}
// GET same: ?q=&folder=&trash=true&offset= (50 per page, filtered by current access)
// GET /:documentId -> DocumentDetail
// PATCH /:documentId {requestId,expectedRevision,title?,folder?,visibility?,defaultPermission?,grants?}
// DELETE /:documentId {requestId,expectedRevision}; POST /:documentId {requestId,expectedRevision,operation:"restore"}
// POST /:documentId/sync DocumentSyncInput -> DocumentSyncResult (authenticated, no cache)
// GET /:documentId/versions -> DocumentVersion[]
// POST /:documentId/versions {requestId,expectedRevision,label}
// GET /:documentId/versions/:versionId -> {version,content,markdown}
// POST same {requestId,expectedRevision,epoch} restores with a NEW epoch; old sessions must reload.
// POST /:documentId/comments {requestId,blockId?,quote?,body}
// PATCH same {requestId,commentId,resolved}; DELETE same {requestId,commentId}
// POST /:documentId/links {requestId,taskId}; DELETE same {requestId,taskId}
// GET /:documentId/export -> authenticated .md download
// POST /:documentId/ai {operation:"polish"|"summarize"|"suggest",selection,epoch,revision}
// -> {text,operation,epoch,revision}; preview only. Client applies on explicit confirmation.
