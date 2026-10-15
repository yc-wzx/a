import { getPersonalDocuments } from "@/lib/documents";
import { PersonalDocumentShortcuts } from "@/components/documents/document-knowledge";
export async function DashboardPersonalDocuments({ actorId }: { actorId: string }) {
  const value = await getPersonalDocuments(actorId).catch(() => null);
  if (!value) return <section className="ac-card p-4 text-sm text-ink-soft" aria-label="个人常用文档">常用文档暂时无法加载，可从项目文档进入。</section>;
  return <PersonalDocumentShortcuts value={value} showProject />;
}
