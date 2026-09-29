import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Link, useLocation } from "react-router";
import { ArrowRight } from "~/components/vora/icons";
import { SurveyLine } from "~/components/vora/primitives";

/**
 * Ask VORA (design system §11.5, AskVora): a way in, not a widget. It exists only when the
 * server says the assistant is available (flag + setting + a server-side key — D8, off today);
 * otherwise no entry point renders at all. The browser never holds a key: it posts to
 * /api/v1/ai/ask, and shows exactly what comes back — an answer with its sources, or the
 * server's own failure message. Nothing is ever generated or filled in on the client.
 *
 * States: unavailable (no entry point), idle, loading (Stop), success, failure (incl. the
 * "disabled" and rate-limit messages from the server).
 */

interface Turn {
  role: "user" | "assistant";
  content: string;
  sources?: { href: string; label: string }[];
}

interface AskVoraContext {
  available: boolean;
  open: () => void;
}

const Context = createContext<AskVoraContext>({ available: false, open: () => {} });

export function useAskVora(): AskVoraContext {
  return useContext(Context);
}

export function AskVoraProvider({
  available,
  maxInputChars,
  children,
}: {
  available: boolean;
  maxInputChars: number;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const location = useLocation();
  const open = useCallback(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);
  // Following a source (or any link) closes the panel.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on route change only
  useEffect(() => {
    if (dialog.current?.open) dialog.current.close();
  }, [location.pathname]);
  return (
    <Context.Provider value={{ available, open }}>
      {children}
      {available ? <AskVoraPanel dialogRef={dialog} maxInputChars={maxInputChars} /> : null}
    </Context.Provider>
  );
}

/** The header / menu / contact entry point: text, never an icon, bubble or sparkle. */
export function AskVoraButton({
  className = "v-ask",
  onBeforeOpen,
}: {
  className?: string;
  onBeforeOpen?: () => void;
}) {
  const { available, open } = useAskVora();
  if (!available) return null;
  return (
    <button
      type="button"
      className={className}
      aria-haspopup="dialog"
      onClick={() => {
        onBeforeOpen?.();
        open();
      }}
    >
      Ask VORA
    </button>
  );
}

async function failureMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    if (body.error?.message) return body.error.message;
  } catch {
    // fall through to the generic message
  }
  return "VORA AI is temporarily unavailable. You can still reach the team through the contact page.";
}

function AskVoraPanel({
  dialogRef,
  maxInputChars,
}: {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  maxInputChars: number;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const controller = useRef<AbortController | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const inputId = useId();
  const tooLong = draft.length > maxInputChars;

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  });

  async function ask(event: React.FormEvent) {
    event.preventDefault();
    const question = draft.trim();
    if (!question || tooLong || status === "loading") return;
    const history: Turn[] = [...turns, { role: "user", content: question }];
    setTurns(history);
    setDraft("");
    setError(null);
    setStatus("loading");
    const abort = new AbortController();
    controller.current = abort;
    try {
      const res = await fetch("/api/v1/ai/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: history.map((t) => ({ role: t.role, content: t.content })),
        }),
        signal: abort.signal,
      });
      if (!res.ok) {
        setError(await failureMessage(res));
        setStatus("error");
        return;
      }
      const answer = (await res.json()) as { text: string; sources: Turn["sources"] };
      setTurns([...history, { role: "assistant", content: answer.text, sources: answer.sources }]);
      setAnnouncement(`VORA AI: ${answer.text}`);
      setStatus("idle");
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") {
        setError("Stopped. Ask again when you're ready.");
      } else {
        setError(
          "VORA AI couldn't be reached. Check your connection, or reach the team through the contact page.",
        );
      }
      setStatus("error");
    } finally {
      controller.current = null;
    }
  }

  return (
    <dialog ref={dialogRef} className="v-ai" aria-labelledby={`${inputId}-title`}>
      <div className="v-ai__head">
        <h2 className="v-label" id={`${inputId}-title`}>
          Ask VORA
        </h2>
        <form method="dialog">
          <button type="submit" className="v-menu-btn">
            Close
          </button>
        </form>
      </div>
      <div className="v-ai__log" ref={log}>
        {turns.length === 0 && status !== "error" ? (
          <p className="v-body-s">Ask a question about VORA's services, work or partnership.</p>
        ) : null}
        {turns.map((turn, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: an append-only transcript
          <div className="v-ai__turn" key={i}>
            <span className="v-label">{turn.role === "user" ? "You" : "VORA AI"}</span>
            <p className={turn.role === "user" ? "v-ui" : "v-body"}>{turn.content}</p>
            {turn.sources && turn.sources.length > 0 ? (
              <div className="v-ai__sources">
                <span className="v-label">Sources</span>
                {turn.sources.map((s) => (
                  <Link key={s.href} className="v-link" to={s.href}>
                    {s.label}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        ))}
        {status === "loading" ? (
          <div className="v-ai__turn" aria-busy="true">
            <span className="v-label">VORA AI</span>
            <SurveyLine variant="sweep" label="VORA AI is answering" />
          </div>
        ) : null}
        {status === "error" && error ? (
          <div className="v-notice" role="alert">
            <span className="v-status v-status--down">Error</span>
            <p>
              {error}{" "}
              <Link className="v-link" to="/contact">
                Talk to a person
              </Link>
              .
            </p>
          </div>
        ) : null}
        <p className="v-sr" aria-live="polite">
          {announcement}
        </p>
      </div>
      <form className="v-ai__compose" onSubmit={ask}>
        <label className="v-sr" htmlFor={inputId}>
          Your question
        </label>
        <textarea
          id={inputId}
          className="v-textarea"
          style={{ minHeight: "5em" }}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-invalid={tooLong ? true : undefined}
          aria-describedby={`${inputId}-count`}
        />
        <div className="v-row" style={{ justifyContent: "space-between" }}>
          <span
            className="v-counter"
            id={`${inputId}-count`}
            aria-live={draft.length > maxInputChars * 0.9 ? "polite" : "off"}
          >
            {draft.length} / {maxInputChars}
          </span>
          {status === "loading" ? (
            <button
              type="button"
              className="v-btn v-btn--secondary v-btn--s"
              onClick={() => controller.current?.abort()}
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              className="v-btn v-btn--primary v-btn--s"
              aria-disabled={!draft.trim() || tooLong ? true : undefined}
            >
              Ask
              <ArrowRight />
            </button>
          )}
        </div>
        <p className="v-ai__disclosure">
          VORA AI answers from published pages on this site and can be wrong.{" "}
          <Link className="v-link" to="/privacy">
            Privacy
          </Link>{" "}
          ·{" "}
          <Link className="v-link" to="/contact">
            Talk to a person
          </Link>
        </p>
      </form>
    </dialog>
  );
}
