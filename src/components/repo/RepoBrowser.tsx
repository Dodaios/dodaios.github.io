/**
 * The repository, live, on the display in the room's corner.
 *
 * GitHub does not allow its pages inside a frame, so this is not GitHub's page:
 * it is a small browser of our own over GitHub's public API. What it shows is
 * the real repository as it is right now: the files, the latest commits, what
 * each commit changed, and any file's text. Every row leads somewhere, and
 * "Open on GitHub" goes to the same place on github.com.
 *
 * It asks GitHub nothing until it comes into view (`client:visible`), and then
 * only what the reader opens. An anonymous browser may ask sixty times an
 * hour; answers are kept for the session, and when the limit is reached or
 * GitHub cannot be reached the view falls back to the snapshot that was taken
 * when the site was built (src/data/repo-map.json) and says so.
 *
 * The page renders the snapshot's file list on the server, so the page without
 * script, and the page without the 3D room, show the repository too.
 * See docs/world.md and the privacy page ("Live figures from GitHub").
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import snapshot from "@/data/repo-map.json";
import "./repo-browser.css";

const REPO = snapshot.repo;
const BRANCH = snapshot.branch;
const SITE = `https://github.com/${REPO}`;
const API = `https://api.github.com/repos/${REPO}`;
/** How much of a file or a diff is shown before the rest is left to GitHub. */
const MAX_FILE_LINES = 400;
const MAX_FILE_BYTES = 300_000;
const MAX_DIFF_FILES = 10;
const MAX_DIFF_LINES = 48;

interface Entry {
  name: string;
  path: string;
  type: string;
  size?: number;
}
interface CommitRow {
  sha: string;
  title: string;
  body: string;
  author: string;
  date: string;
}
interface CommitFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}
interface CommitDetail extends CommitRow {
  additions: number;
  deletions: number;
  files: CommitFile[];
}
interface RepoFacts {
  stars: number;
  forks: number;
  description: string;
}
type View =
  | { kind: "tree"; path: string }
  | { kind: "file"; path: string }
  | { kind: "commits" }
  | { kind: "commit"; sha: string };

class Unreachable extends Error {
  constructor(readonly limited: boolean) {
    super(limited ? "rate limited" : "unreachable");
  }
}

/** One answer per address for the session: the hourly allowance is small. */
const asked = new Map<string, Promise<unknown>>();
function ask<T>(path: string): Promise<T> {
  const url = `${API}${path}`;
  let job = asked.get(url) as Promise<T> | undefined;
  if (job) return job;
  job = (async () => {
    try {
      const kept = sessionStorage.getItem(`repo:${url}`);
      if (kept) return JSON.parse(kept) as T;
    } catch {
      // Storage denied (a private window): ask GitHub.
    }
    let response: Response;
    try {
      response = await fetch(url, { headers: { Accept: "application/vnd.github+json" } });
    } catch {
      throw new Unreachable(false);
    }
    if (!response.ok) throw new Unreachable(response.status === 403 || response.status === 429);
    const data = (await response.json()) as T;
    try {
      const text = JSON.stringify(data);
      if (text.length < 200_000) sessionStorage.setItem(`repo:${url}`, text);
    } catch {
      // Full or denied: the answer still serves this page.
    }
    return data;
  })();
  asked.set(url, job);
  // A failure is not kept: the next press tries again.
  job.catch(() => asked.delete(url));
  return job;
}

const SNAPSHOT_TREES: Record<string, Entry[]> = Object.fromEntries(
  Object.values(snapshot.pages).map((page) => [
    page.path,
    page.entries.map((entry) => ({ ...entry, path: page.path ? `${page.path}/${entry.name}` : entry.name })),
  ]),
);

const byKind = (a: Entry, b: Entry) =>
  a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : b.type === "dir" ? 1 : 0;

function toCommit(raw: Record<string, unknown>): CommitRow {
  const commit = raw.commit as { message: string; author: { name: string; date: string } };
  const [title, ...rest] = commit.message.split("\n");
  return {
    sha: raw.sha as string,
    title,
    body: rest.join("\n").trim(),
    author: (raw.author as { login?: string } | null)?.login ?? commit.author.name,
    date: commit.author.date,
  };
}

function decode(base64: string): string {
  const bytes = Uint8Array.from(atob(base64.replace(/\s/g, "")), (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

const day = (iso: string) => iso.slice(0, 10);
function ago(iso: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`;
  const days = Math.round(minutes / (60 * 24));
  return days < 60 ? `${days} d ago` : day(iso);
}
const bytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} kB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const count = (n: number) => new Intl.NumberFormat("en-US").format(n);

const Icon = ({ kind }: { kind: "dir" | "file" | "commit" | "back" }) => (
  <svg className="repo__icon" data-kind={kind} viewBox="0 0 16 16" aria-hidden="true">
    {kind === "dir" && <path d="M1.5 3.5a1 1 0 0 1 1-1h3.2l1.5 1.5h6.3a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" />}
    {kind === "file" && (
      <path d="M3.5 1.5h5.6l3.4 3.4v9.6h-9zM9 1.8V5h3.2" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    )}
    {kind === "commit" && (
      <path d="M0.5 8h4.2M11.3 8h4.2M8 4.8a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4z" fill="none" stroke="currentColor" strokeWidth="1.3" />
    )}
    {kind === "back" && <path d="M9.5 3 4.5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />}
  </svg>
);

export default function RepoBrowser() {
  const [view, setView] = useState<View>({ kind: "tree", path: "" });
  const [trail, setTrail] = useState<View[]>([]);
  const [facts, setFacts] = useState<RepoFacts>({ stars: snapshot.stars, forks: snapshot.forks, description: snapshot.description });
  const [commits, setCommits] = useState<CommitRow[] | null>(null);
  const [trees, setTrees] = useState<Record<string, Entry[]>>(SNAPSHOT_TREES);
  const [file, setFile] = useState<{ path: string; text: string | null; size: number; note?: string } | null>(null);
  const [commit, setCommit] = useState<CommitDetail | null>(null);
  /** "live": GitHub answered. "limited" / "offline": the snapshot is showing. */
  const [source, setSource] = useState<"snapshot" | "live" | "limited" | "offline">("snapshot");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(0);
  const body = useRef<HTMLDivElement>(null);

  const failed = useCallback((error: unknown) => {
    setSource(error instanceof Unreachable && error.limited ? "limited" : "offline");
  }, []);

  // The first look: the facts in the header, the latest commits, the root's files.
  useEffect(() => {
    setNow(Date.now());
    let alive = true;
    ask<Record<string, unknown>>("")
      .then((repo) => {
        if (!alive) return;
        setFacts({
          stars: repo.stargazers_count as number,
          forks: repo.forks_count as number,
          description: (repo.description as string) ?? "",
        });
        setSource("live");
      })
      .catch((error) => alive && failed(error));
    ask<Record<string, unknown>[]>(`/commits?sha=${BRANCH}&per_page=30`)
      .then((rows) => alive && setCommits(rows.map(toCommit)))
      .catch(() => undefined);
    ask<Entry[]>(`/contents/?ref=${BRANCH}`)
      .then((entries) => alive && setTrees((known) => ({ ...known, "": [...entries].sort(byKind) })))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [failed]);

  const go = useCallback(
    (next: View, remember = true) => {
      if (remember) setTrail((past) => [...past, view]);
      setView(next);
      body.current?.scrollTo({ top: 0 });
      if (next.kind === "tree") {
        setBusy(true);
        ask<Entry[]>(`/contents/${encodeURI(next.path)}?ref=${BRANCH}`)
          .then((entries) => {
            setTrees((known) => ({ ...known, [next.path]: [...entries].sort(byKind) }));
            setSource("live");
          })
          .catch(failed)
          .finally(() => setBusy(false));
      } else if (next.kind === "file") {
        setFile(null);
        setBusy(true);
        ask<{ content?: string; size: number; encoding?: string }>(`/contents/${encodeURI(next.path)}?ref=${BRANCH}`)
          .then((answer) => {
            const readable = answer.encoding === "base64" && answer.content && answer.size <= MAX_FILE_BYTES;
            const text = readable ? decode(answer.content!) : null;
            const binary = text !== null && text.slice(0, 2000).includes("\u0000");
            setFile({
              path: next.path,
              size: answer.size,
              text: binary ? null : text,
              note: binary ? "A binary file." : readable ? undefined : "Too large to show here.",
            });
            setSource("live");
          })
          .catch((error) => {
            failed(error);
            setFile({ path: next.path, size: 0, text: null, note: "GitHub did not answer for this file." });
          })
          .finally(() => setBusy(false));
      } else if (next.kind === "commit") {
        setCommit(null);
        setBusy(true);
        ask<Record<string, unknown>>(`/commits/${next.sha}`)
          .then((raw) => {
            const stats = raw.stats as { additions: number; deletions: number };
            setCommit({ ...toCommit(raw), ...stats, files: raw.files as CommitFile[] });
            setSource("live");
          })
          .catch(failed)
          .finally(() => setBusy(false));
      }
    },
    [failed, view],
  );

  const back = () => {
    const previous = trail[trail.length - 1];
    if (!previous) return;
    setTrail((past) => past.slice(0, -1));
    go(previous, false);
  };

  const here = view.kind === "tree" || view.kind === "file" ? view.path : "";
  const crumbs = useMemo(() => (here ? here.split("/") : []), [here]);
  const entries = view.kind === "tree" ? trees[view.path] : undefined;
  const latest = commits?.[0];
  const onGitHub =
    view.kind === "tree"
      ? view.path
        ? `${SITE}/tree/${BRANCH}/${view.path}`
        : SITE
      : view.kind === "file"
        ? `${SITE}/blob/${BRANCH}/${view.path}`
        : view.kind === "commit"
          ? `${SITE}/commit/${view.sha}`
          : `${SITE}/commits/${BRANCH}`;

  return (
    <div className="repo-window" data-source={source}>
      <header className="repo__head">
        <p className="repo__name">
          <a href={SITE} target="_blank" rel="noopener">
            {REPO.split("/")[0]}
          </a>
          <span aria-hidden="true"> / </span>
          <a href={SITE} target="_blank" rel="noopener">
            <strong>{REPO.split("/")[1]}</strong>
          </a>
          <span className="repo__badge">Public</span>
        </p>
        <p className="repo__facts">
          <span>
            <span aria-hidden="true">★</span> {count(facts.stars)} <span className="repo__dim">stars</span>
          </span>
          <span>
            {count(facts.forks)} <span className="repo__dim">forks</span>
          </span>
          <a className="repo__out" href={onGitHub} target="_blank" rel="noopener">
            Open on GitHub <span aria-hidden="true">↗</span>
          </a>
        </p>
      </header>

      <nav className="repo__tabs" aria-label="Repository">
        <button type="button" aria-current={view.kind === "tree" || view.kind === "file" ? "page" : undefined} onClick={() => go({ kind: "tree", path: "" })}>
          Code
        </button>
        <button type="button" aria-current={view.kind === "commits" || view.kind === "commit" ? "page" : undefined} onClick={() => go({ kind: "commits" })}>
          Commits
        </button>
        <span className="repo__branch">{BRANCH}</span>
      </nav>

      <div className="repo__body" ref={body} aria-busy={busy}>
        {(view.kind === "tree" || view.kind === "file") && (
          <>
            <p className="repo__crumbs">
              {trail.length > 0 && (
                <button type="button" className="repo__back" onClick={back} aria-label="Back">
                  <Icon kind="back" />
                </button>
              )}
              <button type="button" onClick={() => go({ kind: "tree", path: "" })}>
                {REPO.split("/")[1]}
              </button>
              {crumbs.map((part, i) => {
                const path = crumbs.slice(0, i + 1).join("/");
                const last = i === crumbs.length - 1;
                return (
                  <span key={path}>
                    <span aria-hidden="true"> / </span>
                    {last ? <strong>{part}</strong> : <button type="button" onClick={() => go({ kind: "tree", path })}>{part}</button>}
                  </span>
                );
              })}
            </p>

            {view.kind === "tree" && !view.path && latest && (
              <button type="button" className="repo__latest" onClick={() => go({ kind: "commit", sha: latest.sha })}>
                <Icon kind="commit" />
                <span className="repo__latest-title">{latest.title}</span>
                <span className="repo__dim">
                  {latest.sha.slice(0, 7)} · {now ? ago(latest.date, now) : day(latest.date)}
                </span>
              </button>
            )}

            {view.kind === "tree" && (
              <ul className="repo__rows">
                {(entries ?? []).map((entry) => (
                  <li key={entry.path}>
                    <button
                      type="button"
                      onClick={() => go(entry.type === "dir" ? { kind: "tree", path: entry.path } : { kind: "file", path: entry.path })}
                    >
                      <Icon kind={entry.type === "dir" ? "dir" : "file"} />
                      <span className="repo__row-name">{entry.name}</span>
                      {entry.type !== "dir" && entry.size !== undefined && <span className="repo__dim">{bytes(entry.size)}</span>}
                    </button>
                  </li>
                ))}
                {!entries && <li className="repo__wait">{busy ? "Asking GitHub…" : "GitHub did not answer for this folder."}</li>}
              </ul>
            )}

            {view.kind === "file" && (
              <div className="repo__file">
                {!file && <p className="repo__wait">Asking GitHub…</p>}
                {file && file.text === null && (
                  <p className="repo__wait">
                    {file.note}{" "}
                    <a href={onGitHub} target="_blank" rel="noopener">
                      Open it on GitHub
                    </a>
                  </p>
                )}
                {file && file.text !== null && <FileText text={file.text} size={file.size} href={onGitHub} />}
              </div>
            )}
          </>
        )}

        {view.kind === "commits" && (
          <ul className="repo__rows repo__rows--commits">
            {(commits ?? []).map((row) => (
              <li key={row.sha}>
                <button type="button" onClick={() => go({ kind: "commit", sha: row.sha })}>
                  <Icon kind="commit" />
                  <span className="repo__row-name">{row.title}</span>
                  <span className="repo__dim">
                    {row.author} · {now ? ago(row.date, now) : day(row.date)} · {row.sha.slice(0, 7)}
                  </span>
                </button>
              </li>
            ))}
            {!commits && (
              <li className="repo__wait">
                {source === "limited" || source === "offline" ? (
                  <>
                    The latest commit in the snapshot: <strong>{snapshot.lastCommit.message}</strong> ({snapshot.lastCommit.sha},{" "}
                    {day(snapshot.lastCommit.date)}).
                  </>
                ) : (
                  "Asking GitHub…"
                )}
              </li>
            )}
          </ul>
        )}

        {view.kind === "commit" && (
          <div className="repo__commit">
            <p className="repo__crumbs">
              <button type="button" className="repo__back" onClick={back} aria-label="Back">
                <Icon kind="back" />
              </button>
              <button type="button" onClick={() => go({ kind: "commits" })}>
                Commits
              </button>
              <span aria-hidden="true"> / </span>
              <strong>{view.sha.slice(0, 7)}</strong>
            </p>
            {!commit && <p className="repo__wait">{busy ? "Asking GitHub…" : "GitHub did not answer for this commit."}</p>}
            {commit && (
              <>
                <h3 className="repo__commit-title">{commit.title}</h3>
                {commit.body && <pre className="repo__commit-body">{commit.body}</pre>}
                <p className="repo__dim">
                  {commit.author} · {day(commit.date)} · {commit.files.length} {commit.files.length === 1 ? "file" : "files"} ·{" "}
                  <span className="repo__add">+{count(commit.additions)}</span> <span className="repo__del">−{count(commit.deletions)}</span>
                </p>
                {commit.files.slice(0, MAX_DIFF_FILES).map((changed) => (
                  <Diff key={changed.filename} file={changed} />
                ))}
                {commit.files.length > MAX_DIFF_FILES && (
                  <p className="repo__wait">
                    {commit.files.length - MAX_DIFF_FILES} more files.{" "}
                    <a href={onGitHub} target="_blank" rel="noopener">
                      See the whole commit on GitHub
                    </a>
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <p className="repo__foot" role="status">
        {source === "live" && "Live from GitHub's public API."}
        {source === "snapshot" && `The repository as it was on ${day(snapshot.readAt)}. Checking GitHub…`}
        {source === "limited" &&
          `GitHub allows an anonymous browser sixty questions an hour, and this hour's are used up. Showing the snapshot of ${day(snapshot.readAt)} where it has one.`}
        {source === "offline" && `GitHub could not be reached. Showing the snapshot of ${day(snapshot.readAt)} where it has one.`}
      </p>
    </div>
  );
}

function FileText({ text, size, href }: { text: string; size: number; href: string }) {
  const lines = text.replace(/\n$/, "").split("\n");
  const shown = lines.slice(0, MAX_FILE_LINES);
  return (
    <>
      <p className="repo__dim repo__file-facts">
        {count(lines.length)} lines · {bytes(size)}
      </p>
      <ol className="repo__code">
        {shown.map((line, i) => (
          <li key={i}>
            <code>{line || " "}</code>
          </li>
        ))}
      </ol>
      {lines.length > MAX_FILE_LINES && (
        <p className="repo__wait">
          The first {MAX_FILE_LINES} of {count(lines.length)} lines.{" "}
          <a href={href} target="_blank" rel="noopener">
            Read the rest on GitHub
          </a>
        </p>
      )}
    </>
  );
}

function Diff({ file }: { file: CommitFile }) {
  const lines = file.patch ? file.patch.split("\n") : [];
  return (
    <section className="repo__diff">
      <p className="repo__diff-head">
        <span className="repo__row-name">{file.filename}</span>
        <span className="repo__dim">
          {file.status} · <span className="repo__add">+{file.additions}</span> <span className="repo__del">−{file.deletions}</span>
        </span>
      </p>
      {lines.length > 0 && (
        <pre className="repo__patch">
          {lines.slice(0, MAX_DIFF_LINES).map((line, i) => (
            <span key={i} data-kind={line.startsWith("@@") ? "hunk" : line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : undefined}>
              {line || " "}
              {"\n"}
            </span>
          ))}
          {lines.length > MAX_DIFF_LINES && <span data-kind="hunk">… {lines.length - MAX_DIFF_LINES} more lines{"\n"}</span>}
        </pre>
      )}
    </section>
  );
}
