export async function api(
  url: string,
  body?: unknown,
  method?: string,
  timeoutMs = 60_000,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch("/api" + url, {
      method: method || (body ? "POST" : "GET"),
      headers:
        body instanceof FormData
          ? undefined
          : body
            ? { "Content-Type": "application/json" }
            : undefined,
      body:
        body instanceof FormData
          ? body
          : body
            ? JSON.stringify(body)
            : undefined,
      signal: controller.signal,
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || `请求失败（${response.status}）`);
    return result;
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error(
        "请求超时，请检查启动窗口是否仍在运行；导入可能已完成，请先查看导入记录或词库，再决定是否重试。",
      );
    if (error instanceof TypeError)
      throw new Error("无法连接本地服务，请检查启动窗口并重试。");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
