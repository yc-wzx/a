import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { AppError } from "@/lib/errors";
function key() {
  const master = process.env.CALENDAR_ENCRYPTION_KEY ?? process.env.AI_SETTINGS_ENCRYPTION_KEY;
  if (!master || !/^[a-f0-9]{64}$/i.test(master)) throw new AppError("外部日历加密配置尚未准备好，请联系负责人");
  return createHmac("sha256", Buffer.from(master,"hex")).update("AgileCampus calendar credentials v1").digest();
}
export function sealCalendarSecret(actor: string, text: string) {
  const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm",key(),nonce); cipher.setAAD(Buffer.from(`${actor}:calendar`));
  const value = Buffer.concat([cipher.update(text,"utf8"),cipher.final()]);
  return ["v1",nonce.toString("base64url"),cipher.getAuthTag().toString("base64url"),value.toString("base64url")].join(".");
}
export function openCalendarSecret(actor: string, envelope: string) {
  try {
    const [version,nonce,tag,body,extra] = envelope.split(".");
    if (version !== "v1" || !nonce || !tag || !body || extra) throw new Error();
    const cipher = createDecipheriv("aes-256-gcm",key(),Buffer.from(nonce,"base64url")); cipher.setAAD(Buffer.from(`${actor}:calendar`)); cipher.setAuthTag(Buffer.from(tag,"base64url"));
    return Buffer.concat([cipher.update(Buffer.from(body,"base64url")),cipher.final()]).toString("utf8");
  } catch { throw new AppError("外部日历连接无法解密，请移除后重新添加"); }
}
