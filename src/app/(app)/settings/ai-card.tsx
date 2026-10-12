"use client";
import { useState, useTransition } from "react";
import {
  AI_PROVIDERS,
  type AiProviderId,
  type PersonalAiSummary,
} from "@/lib/agent/provider-options";
import {
  clearMyAiSettingsAction,
  saveMyAiSettingsAction,
  testMyAiConnectionAction,
} from "./actions";

export function AiCard({ initial }: { initial: PersonalAiSummary }) {
  const [current, setCurrent] = useState(initial),
    [provider, setProvider] = useState(initial.provider);
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl),
    [modelId, setModelId] = useState(initial.modelId);
  const [name, setName] = useState(initial.assistantName),
    [instructions, setInstructions] = useState(initial.instructions);
  const [apiKey, setApiKey] = useState(""),
    [notice, setNotice] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function choose(value: AiProviderId) {
    const preset = AI_PROVIDERS.find((p) => p.id === value)!;
    setProvider(value);
    setBaseUrl(preset.baseUrl);
    setModelId(preset.modelId);
    setApiKey("");
    setNotice(null);
  }
  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    start(async () => {
      const result = await saveMyAiSettingsAction({
        provider,
        baseUrl,
        modelId,
        apiKey,
        assistantName: name,
        instructions,
        expectedRevision: current.revision,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCurrent(result.data);
      setApiKey("");
      setNotice("已保存个人配置。可以测试连接，再到项目使用助手。");
    });
  }
  function test() {
    setError(null);
    setNotice(null);
    start(async () => {
      const result = await testMyAiConnectionAction();
      if (!result.ok) setError(result.error);
      else
        setNotice(
          "连接成功。此测试验证普通问答；项目助手还需要模型支持工具调用。",
        );
    });
  }
  function clear() {
    if (!confirm("删除自己的 AI 配置和已保存密钥？已有会话与项目数据保留。"))
      return;
    setError(null);
    setNotice(null);
    start(async () => {
      const result = await clearMyAiSettingsAction(current.revision);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const empty = result.data;
      setCurrent(empty);
      setProvider(empty.provider);
      setBaseUrl(empty.baseUrl);
      setModelId(empty.modelId);
      setName(empty.assistantName);
      setInstructions("");
      setApiKey("");
      setNotice("已删除个人 AI 配置。其他协作功能和规则规划仍可使用。");
    });
  }
  return (
    <section
      id="my-ai"
      data-tour="ai-settings"
      className="ac-card space-y-4 p-5"
    >
      <div>
        <h2 className="font-semibold">我的 AI 助手</h2>
        <p className="mt-1 text-sm text-ink-soft">
          每个人使用自己的服务商、模型和密钥。个人配置仅本人可见；未配置时仍可管理项目和使用规则规划。
        </p>
      </div>
      <p className="text-xs text-ink-soft">
        {current.configured
          ? "已保存密钥，加密存储；页面不会显示原密钥。密钥留空可保持现有密钥。"
          : "尚未配置个人助手。密钥从你选择的服务商 API 控制台获取。"}
      </p>
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-sm">
          服务商
          <select
            name="provider"
            value={provider}
            onChange={(e) => choose(e.target.value as AiProviderId)}
            className="ac-field mt-1 w-full"
          >
            {AI_PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {provider === "compatible" && (
          <label className="block text-sm">
            兼容接口地址
            <input
              name="baseUrl"
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://服务商地址/v1"
              className="ac-field mt-1 w-full"
              required
            />
            <span className="mt-1 block text-xs text-ink-soft">
              使用负责人已开放的 HTTPS 兼容接口。
            </span>
          </label>
        )}
        <label className="block text-sm">
          模型名称
          <input
            name="modelId"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            placeholder="从服务商控制台复制模型名称"
            required
            maxLength={160}
            className="ac-field mt-1 w-full"
          />
        </label>
        <label className="block text-sm">
          API 密钥
          <input
            name="apiKey"
            type="password"
            autoComplete="new-password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={
              current.configured
                ? "留空保持原密钥；填写新密钥即可替换"
                : "填写自己的 API 密钥"
            }
            maxLength={4096}
            className="ac-field mt-1 w-full"
          />
        </label>
        <label className="block text-sm">
          助手名称
          <input
            name="assistantName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={50}
            className="ac-field mt-1 w-full"
          />
        </label>
        <label className="block text-sm">
          表达偏好（可选）
          <textarea
            name="instructions"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            maxLength={2000}
            placeholder="例如：请用适合大二学生理解的中文，按可执行步骤回答。"
            rows={3}
            className="ac-field mt-1 w-full"
          />
        </label>
        <button disabled={pending} className="ac-btn">
          {pending ? "处理中…" : "保存个人 AI 配置"}
        </button>
      </form>
      {current.configured && (
        <div className="flex gap-3">
          <button
            type="button"
            disabled={pending}
            onClick={test}
            className="ac-btn-ghost"
          >
            测试已保存的连接
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={clear}
            className="ac-btn-ghost text-high"
          >
            删除个人 AI 配置
          </button>
        </div>
      )}
      <p className="text-xs text-ink-soft">
        连接测试发送一条短消息，按服务商规则计费。修改后请先保存；测试使用已保存的配置。
      </p>
      {notice && (
        <p role="status" className="text-sm text-primary">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-high">
          {error}
        </p>
      )}
    </section>
  );
}
