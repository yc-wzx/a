/** Public readiness flags only. Application secrets stay on the server. */
export function getFeishuConfiguration() {
  const notifications = !!process.env.FEISHU_APP_ID?.trim() && !!process.env.FEISHU_APP_SECRET?.trim();
  let validCallback = false;
  try {
    const callback = new URL(process.env.FEISHU_REDIRECT_URI ?? "");
    validCallback = ["https:", "http:"].includes(callback.protocol) && !callback.username && !callback.password
      && callback.pathname === "/api/auth/feishu/callback" && !callback.hash && !callback.search
      && (process.env.NODE_ENV !== "production" || callback.protocol === "https:");
  } catch { /* An absent or malformed callback keeps login disabled. */ }
  return { login: notifications && validCallback, notifications };
}
