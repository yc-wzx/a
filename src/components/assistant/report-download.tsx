"use client";
import { useState } from "react";

export function ReportDownload({ messageId }: { messageId: string }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function download() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/assistant/messages/${messageId}/document`, { cache: "no-store" });
      if (!response.ok) throw new Error((await response.json()).error);
      const url = URL.createObjectURL(await response.blob());
      const filename = /filename\*=UTF-8''([^;]+)/i.exec(response.headers.get("content-disposition") ?? "");
      const link = document.createElement("a"); link.href = url;
      link.download = filename ? decodeURIComponent(filename[1]) : "AgileCampus-报告.docx";
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setError(error instanceof Error ? error.message : "下载失败，请重试"); }
    finally { setBusy(false); }
  }
  return <span className="ml-4 inline-block"><button className="text-xs text-primary" disabled={busy} onClick={() => void download()}>{busy ? "正在生成 Word…" : "下载 Word"}</button>{error && <span role="alert" className="ml-2 text-xs text-high">{error}</span>}</span>;
}
