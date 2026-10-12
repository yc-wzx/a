import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { AppError } from "@/lib/errors";

function key() {
  const value = process.env.AI_SETTINGS_ENCRYPTION_KEY;
  if (!value || !/^[a-f0-9]{64}$/i.test(value))
    throw new AppError("个人 AI 配置暂不可用，请联系负责人");
  return Buffer.from(value, "hex");
}

export function encryptPersonalApiKey(userId: string, apiKey: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), nonce);
  cipher.setAAD(Buffer.from(userId));
  const data = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  return [
    "v1",
    nonce.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    data.toString("base64url"),
  ].join(".");
}

export function decryptPersonalApiKey(userId: string, encrypted: string) {
  const master = key();
  try {
    const [version, nonce, tag, data, extra] = encrypted.split(".");
    if (version !== "v1" || !nonce || !tag || !data || extra)
      throw Error("Invalid envelope");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      master,
      Buffer.from(nonce, "base64url"),
    );
    decipher.setAAD(Buffer.from(userId));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(data, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new AppError("个人 AI 密钥无法读取，请在设置中重新填写密钥");
  }
}
