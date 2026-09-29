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
import "./styles/base.css";

export async function loader({ context }: Route.LoaderArgs) {
  const { actor, cspNonce, server } = load(context);
  return {
    nonce: cspNonce,
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

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
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
    <main id="main" className="container" style={{ paddingBlock: "var(--space-10)" }}>
      <div className="stack" style={{ maxWidth: "40rem" }}>
        <p className="label">Error {status}</p>
        <h1>{heading}</h1>
        <p className="muted">{message}</p>
        <p>
          <Link to="/">Return to the homepage</Link>
          {status === 401 ? (
            <>
              {" · "}
              <Link to="/login">Sign in</Link>
            </>
          ) : null}
        </p>
      </div>
    </main>
  );
}
