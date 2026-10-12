// Safe to import into the settings UI. No credentials or environment access here.
export const AI_PROVIDERS = [
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    modelId: "deepseek-flash",
  },
  {
    id: "dashscope",
    name: "阿里云百炼（千问）",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    modelId: "qwen-plus",
  },
  {
    id: "siliconflow",
    name: "硅基流动",
    baseUrl: "https://api.siliconflow.cn/v1",
    modelId: "",
  },
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    modelId: "",
  },
  { id: "compatible", name: "其他兼容服务", baseUrl: "", modelId: "" },
] as const;
export type AiProviderId = (typeof AI_PROVIDERS)[number]["id"];

export type PersonalAiSummary = {
  configured: boolean;
  provider: AiProviderId;
  baseUrl: string;
  modelId: string;
  assistantName: string;
  instructions: string;
  revision: number;
};
