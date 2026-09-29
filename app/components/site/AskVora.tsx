import {
  createContext,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useLocation } from "react-router";

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

/** The panel's code loads only when the assistant is available (it is off by default). */
const AskVoraPanel = lazy(() => import("./AskVoraPanel"));

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
  // Each request to open increments the signal; the panel opens itself when it changes.
  const [openSignal, setOpenSignal] = useState(0);
  const [closeSignal, setCloseSignal] = useState(0);
  const location = useLocation();
  const open = useCallback(() => setOpenSignal((n) => n + 1), []);
  // Following a source (or any link) closes the panel.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on route change only
  useEffect(() => {
    setCloseSignal((n) => n + 1);
  }, [location.pathname]);
  return (
    <Context.Provider value={{ available, open }}>
      {children}
      {available && openSignal > 0 ? (
        <Suspense fallback={null}>
          <AskVoraPanel
            maxInputChars={maxInputChars}
            openSignal={openSignal}
            closeSignal={closeSignal}
          />
        </Suspense>
      ) : null}
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
