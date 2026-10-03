import { describe, expect, it } from "vitest";
import { GitHubError, upsertComment } from "../src/github.js";
import { COMMENT_MARKER } from "../src/report.js";
import type { FetchLike } from "../src/types.js";

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

type Reply = { status?: number; json: unknown };

function fake(handler: (c: Call) => Reply) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const call: Call = { method: init.method ?? "GET", url, headers: (init.headers ?? {}) as Record<string, string>, body: init.body as string | undefined };
    calls.push(call);
    const r = handler(call);
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200 });
  };
  return { fetch, calls };
}

const base = { apiUrl: "https://api.test", token: "tok", repo: "o/r", pr: 5, body: `${COMMENT_MARKER}\nhello` };
const others = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1, body: `c${i}` }));
const created = { id: 99, html_url: "https://gh.test/c/99" };

describe("upsertComment", () => {
  it("lists then creates when nothing matches", async () => {
    const f = fake((c) => (c.method === "GET" ? { json: [] } : { status: 201, json: created }));
    const r = await upsertComment({ ...base, fetch: f.fetch });
    expect(r).toEqual({ action: "created", id: 99, url: "https://gh.test/c/99" });
    expect(f.calls.map((c) => c.method)).toEqual(["GET", "POST"]);
    expect(f.calls[1].url).toBe("https://api.test/repos/o/r/issues/5/comments");
    expect(JSON.parse(f.calls[1].body!).body.startsWith(COMMENT_MARKER)).toBe(true);
  });

  it("pages through comments and patches the marker comment on page 2", async () => {
    const f = fake((c) => {
      if (c.method === "GET") return { json: c.url.endsWith("&page=1") ? others(100) : [{ id: 77, body: `${COMMENT_MARKER}\nold` }] };
      return { json: { id: 77, html_url: "https://gh.test/c/77" } };
    });
    const r = await upsertComment({ ...base, fetch: f.fetch });
    expect(r.action).toBe("updated");
    const last = f.calls.at(-1)!;
    expect(last.method).toBe("PATCH");
    expect(last.url).toBe("https://api.test/repos/o/r/issues/comments/77");
  });

  it("never patches a comment without the marker", async () => {
    const f = fake((c) => (c.method === "GET" ? { json: [{ id: 1, body: "bot said hi" }] } : { json: created }));
    await upsertComment({ ...base, fetch: f.fetch });
    expect(f.calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("patches the newest of two marker comments", async () => {
    const f = fake((c) =>
      c.method === "GET" ? { json: [{ id: 10, body: COMMENT_MARKER }, { id: 11, body: "x" }, { id: 12, body: COMMENT_MARKER }] } : { json: created },
    );
    await upsertComment({ ...base, fetch: f.fetch });
    expect(f.calls.at(-1)!.url.endsWith("/issues/comments/12")).toBe(true);
  });

  it("prepends the marker when the body lacks it", async () => {
    const f = fake((c) => (c.method === "GET" ? { json: [] } : { json: created }));
    await upsertComment({ ...base, body: "plain", fetch: f.fetch });
    expect(JSON.parse(f.calls[1].body!).body).toBe(`${COMMENT_MARKER}\nplain`);
  });

  it("sends auth, accept and api-version headers and strips a trailing slash", async () => {
    const f = fake((c) => (c.method === "GET" ? { json: [] } : { json: created }));
    await upsertComment({ ...base, apiUrl: "https://api.test/", fetch: f.fetch });
    for (const c of f.calls) {
      expect(c.headers.authorization).toBe("Bearer tok");
      expect(c.headers.accept).toBe("application/vnd.github+json");
      expect(c.headers["x-github-api-version"]).toBe("2022-11-28");
      expect(c.url.startsWith("https://api.test/repos")).toBe(true);
    }
    expect(f.calls[1].headers["content-type"]).toBe("application/json");
  });

  it("throws GitHubError with the status on a 403", async () => {
    const f = fake((c) => (c.method === "GET" ? { json: [] } : { status: 403, json: { message: "Resource not accessible" } }));
    const err = await upsertComment({ ...base, fetch: f.fetch }).catch((e) => e);
    expect(err).toBeInstanceOf(GitHubError);
    expect(err.status).toBe(403);
    expect(err.message).toContain("403");
  });

  it("rejects a bad repo or pr before any fetch", async () => {
    const f = fake(() => ({ json: [] }));
    await expect(upsertComment({ ...base, repo: "no-slash", fetch: f.fetch })).rejects.toBeInstanceOf(GitHubError);
    await expect(upsertComment({ ...base, pr: 0, fetch: f.fetch })).rejects.toBeInstanceOf(GitHubError);
    expect(f.calls).toHaveLength(0);
  });

  it("wraps a thrown fetch", async () => {
    const fetch: FetchLike = async () => {
      throw new Error("offline");
    };
    await expect(upsertComment({ ...base, fetch })).rejects.toThrow(/request failed: offline/);
  });
});
