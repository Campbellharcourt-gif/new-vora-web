import { isbot } from "isbot";
import { renderToReadableStream } from "react-dom/server";
import type { EntryContext, RouterContextProvider } from "react-router";
import { ServerRouter } from "react-router";
import { appContext } from "./.server/context";

/** Abort streaming renders that take too long (the kernel logs the resulting error). */
export const streamTimeout = 10_000;

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  loadContext: RouterContextProvider,
) {
  const { cspNonce, server } = loadContext.get(appContext);
  let status = responseStatusCode;
  let shellRendered = false;

  const body = await renderToReadableStream(
    <ServerRouter context={routerContext} url={request.url} nonce={cspNonce} />,
    {
      nonce: cspNonce,
      signal: AbortSignal.timeout(streamTimeout),
      onError(error: unknown) {
        status = 500;
        // Errors before the shell renders are handled by React Router's error boundary flow.
        if (shellRendered) server.log.error("stream_render_error", { error: String(error) });
      },
    },
  );
  shellRendered = true;

  // Crawlers get the complete document (better SEO); people get streaming.
  const userAgent = request.headers.get("user-agent");
  if ((userAgent && isbot(userAgent)) || routerContext.isSpaMode) {
    await body.allReady;
  }

  responseHeaders.set("Content-Type", "text/html; charset=utf-8");
  return new Response(body, { headers: responseHeaders, status });
}
