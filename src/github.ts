import { COMMENT_MARKER } from "./report.js";
import type { FetchLike } from "./types.js";

export class GitHubError extends Error {
  name = "GitHubError";
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface UpsertOptions {
  fetch: FetchLike;
  apiUrl: string;
  token: string;
  repo: string;
  pr: number;
  body: string;
}

export interface UpsertResult {
  action: "created" | "updated";
  id: number;
  url: string;
}

const PAGE_SIZE = 100;
const MAX_PAGES = 30;

/** Create the evalgate PR comment, or edit the newest one that carries the marker. */
export async function upsertComment(opts: UpsertOptions): Promise<UpsertResult> {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(opts.repo)) throw new GitHubError(`invalid repo "${opts.repo}" (expected owner/name)`);
  if (!Number.isInteger(opts.pr) || opts.pr <= 0) throw new GitHubError(`invalid pull request number "${opts.pr}"`);
  const api = opts.apiUrl.replace(/\/+$/, "");
  const body = opts.body.startsWith(COMMENT_MARKER) ? opts.body : `${COMMENT_MARKER}\n${opts.body}`;
  const headers: Record<string, string> = {
    authorization: `Bearer ${opts.token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "evalgate",
  };

  async function call(method: string, pathname: string, payload?: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await opts.fetch(`${api}${pathname}`, {
        method,
        headers: payload === undefined ? headers : { ...headers, "content-type": "application/json" },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      });
    } catch (e) {
      throw new GitHubError(`GitHub API request failed: ${(e as Error).message}`);
    }
    if (!res.ok) {
      throw new GitHubError(`GitHub API ${method} ${pathname} returned ${res.status}: ${(await res.text()).slice(0, 300)}`, res.status);
    }
    return res.json();
  }

  const issue = `/repos/${opts.repo}/issues/${opts.pr}`;
  let existing: number | undefined;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const items = (await call("GET", `${issue}/comments?per_page=${PAGE_SIZE}&page=${page}`)) as { id: number; body?: string }[];
    for (const c of items) if ((c.body ?? "").trimStart().startsWith(COMMENT_MARKER)) existing = c.id;
    if (items.length < PAGE_SIZE) break;
  }

  const action = existing === undefined ? "created" : "updated";
  const res = (await (existing === undefined
    ? call("POST", `${issue}/comments`, { body })
    : call("PATCH", `/repos/${opts.repo}/issues/comments/${existing}`, { body }))) as { id: number; html_url: string };
  return { action, id: res.id, url: res.html_url };
}
