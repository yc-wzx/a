import type { Result } from "@/contracts/p0-p2";

export class DocumentRequestError extends Error {
  constructor(message: string, public code: string, public status: number) {
    super(message);
  }
}
export async function documentRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const signal = init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000);
  try {
    const response = await fetch(url, {
      ...init,
      signal,
      cache: "no-store",
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
    const result = await response.json() as Result<T>;
    if (!result.ok) throw new DocumentRequestError(result.error, result.code, response.status);
    if (!response.ok) throw new DocumentRequestError("请求失败，请稍后重试。", "INTERNAL", response.status);
    return result.data;
  } catch (error) {
    if (error instanceof DocumentRequestError || init?.signal?.aborted) throw error;
    if (error instanceof Error && error.name === "TimeoutError") throw new DocumentRequestError("连接超时，请检查网络后重试；当前页面的输入仍保留。", "NETWORK", 408);
    throw new DocumentRequestError("网络连接暂时不可用，请稍后重试。", "NETWORK", 503);
  }
}
export function documentMutation<T>(url: string, method: string, input: Record<string, unknown>) {
  return documentRequest<T>(url, { method, body: JSON.stringify({ requestId: crypto.randomUUID(), ...input }) });
}
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请重试。";
}
