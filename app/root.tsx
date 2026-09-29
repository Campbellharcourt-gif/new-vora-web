import {
  isRouteErrorResponse,
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from "react-router";
import { load } from "./.server/guards";
import type { Route } from "./+types/root";
import sansFont from "./assets/fonts/Archivo-Variable-Latin.woff2?url";
import { Logo } from "./components/ui/Logo";
import { SurveyLine } from "./components/vora/primitives";
import "./styles/base.css";

export async function loader({ context }: Route.LoaderArgs) {
  const { actor, cspNonce, server } = load(context);
  return {
    nonce: cspNonce,
    requestId: server.requestId,
    appEnv: server.config.appEnv,
    origin: server.config.origin,
    user: actor
      ? {
          name: actor.name,
          canAdmin: actor.permissions.has("admin.access"),
          canClient: actor.permissions.has("client_portal.access"),
          canMember: actor.permissions.has("member_portal.access"),
        }
      : null,
  };
}

/** Only Archivo is preloaded on every page (design system §14); the display cut is preloaded by
 *  the public layout, where it sets the first headline. */
export const links: Route.LinksFunction = () => [
  { rel: "preload", href: sansFont, as: "font", type: "font/woff2", crossOrigin: "anonymous" },
];

export function meta(): Route.MetaDescriptors {
  return [
    { title: "VORA" },
    {
      name: "description",
      content: "VORA is a digital studio building websites and digital experiences.",
    },
  ];
}

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useRouteLoaderData<typeof loader>("root");
  const nonce = data?.nonce;
  return (
    <html lang="en-AU">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="color-scheme" content="dark light" />
        <meta name="theme-color" content="#0a0c0b" />
        <meta name="format-detection" content="telephone=no" />
        {/* No favicon until app icons are made from the supplied VORA logo (no invented mark);
            the empty data URL stops browsers requesting /favicon.ico and logging a 404. */}
        <link rel="icon" href="data:," />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration nonce={nonce} />
        <Scripts nonce={nonce} />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

/**
 * 404, errors and access problems (design system §16.13): calm, typographic, Basalt, the
 * existing copy, the survey line as a horizon, and the request reference in DM Mono so support
 * can trace a failure. Never technical details in production.
 */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const root = useRouteLoaderData<typeof loader>("root");
  let status = 500;
  let heading = "Something went wrong on our side.";
  let message = "The team has been notified. Please try again in a few minutes.";

  if (isRouteErrorResponse(error)) {
    status = error.status;
    const provided = (error.data as { message?: string } | undefined)?.message;
    if (status === 404) {
      heading = "This page doesn't exist.";
      message = "It may have moved, or the link may be incorrect.";
    } else if (status === 403) {
      heading = "You don't have access to this.";
      message = provided ?? "If you think you should, ask a VORA administrator.";
    } else if (status === 401) {
      heading = "Please sign in to continue.";
      message = "Your session may have expired.";
    } else if (status === 503) {
      heading = "This service is temporarily unavailable.";
      message = provided ?? "Please try again shortly.";
    } else if (status < 500 && provided) {
      heading = "We couldn't complete that request.";
      message = provided;
    }
  } else if (import.meta.env.DEV && error instanceof Error) {
    message = error.message;
  }

  return (
    <div className="v-system v-container">
      <a className="skip-link" href="#main" tabIndex={0}>
        Skip to content
      </a>
      <header className="v-system__top">
        <Link to="/" className="v-brand-link" aria-label="VORA — home">
          <Logo title="" />
        </Link>
      </header>
      <main id="main" className="v-system__body">
        <p className="v-label">{status === 404 ? "404 — Not found" : `Error ${status}`}</p>
        <h1 className="v-display-m">{heading}</h1>
        <p className="v-lead">{message}</p>
        <SurveyLine strong />
        <nav className="v-system__links" aria-label="Where next">
          <Link className="v-arrowlink" to="/">
            <span>Return to the homepage</span>
          </Link>
          {status === 404 ? (
            <>
              <Link className="v-arrowlink" to="/work">
                <span>Work</span>
              </Link>
              <Link className="v-arrowlink" to="/contact">
                <span>Contact</span>
              </Link>
            </>
          ) : null}
          {status === 401 ? (
            <Link className="v-arrowlink" to="/login">
              <span>Sign in</span>
            </Link>
          ) : null}
        </nav>
      </main>
      <footer className="v-footer__base" style={{ marginTop: 0, marginBottom: "var(--space-6)" }}>
        {root?.requestId ? (
          <p className="v-data v-secondary">Reference {root.requestId}</p>
        ) : (
          <p className="v-label">VORA</p>
        )}
      </footer>
    </div>
  );
}
