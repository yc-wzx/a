import type { Result } from "@/contracts/p0-p2";

export class DocumentRequestError extends Error {
  constructor(message: string, public code: string, public status: number) {
    super(message);
  }
}
export async function documentRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const result = await response.json() as Result<T>;
  if (!result.ok) throw new DocumentRequestError(result.error, result.code, response.status);
  if (!response.ok) throw new DocumentRequestError("请求失败，请稍后重试。", "INTERNAL", response.status);
  return result.data;
}
export function documentMutation<T>(url: string, method: string, input: Record<string, unknown>) {
  return documentRequest<T>(url, { method, body: JSON.stringify({ requestId: crypto.randomUUID(), ...input }) });
}
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请重试。";
}
