// The scope matrix, checked over HTTP against any device URL.
export interface Check {
  required?: boolean;
  name: string;
  ok: boolean;
  detail: string;
}

async function statusOf(url: string, init: RequestInit = {}): Promise<number> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
    await res.body?.cancel();
    return res.status;
  } catch {
    return 0;
  }
}

export async function probe(
  base: string,
  tokens: { client?: string; cron?: string },
): Promise<Check[]> {
  const bearer = (t?: string) => (t ? { authorization: `Bearer ${t}` } : {});
  const post = (t?: string) => ({
    method: "POST",
    headers: { ...bearer(t), "content-type": "application/json" },
    body: JSON.stringify({ requestId: "probe" }),
  });
  const expect = async (
    name: string,
    want: number,
    url: string,
    init?: RequestInit,
  ): Promise<Check> => {
    const got = await statusOf(url, init);
    return { name, ok: got === want, detail: got ? `${got}` : "unreachable" };
  };
  return [
    await expect("healthz is open", 200, `${base}/healthz`),
    await expect("info without a token is 401", 401, `${base}/v1/info`),
    await expect("info with the client token is 200", 200, `${base}/v1/info`, {
      headers: bearer(tokens.client),
    }),
    await expect("info with the cron token is 403", 403, `${base}/v1/info`, {
      headers: bearer(tokens.cron),
    }),
    await expect(
      "the workflow route with the client token is 403",
      403,
      `${base}/v1/workflows/news-sweep`,
      post(tokens.client),
    ),
  ];
}
