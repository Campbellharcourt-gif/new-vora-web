import { data } from "react-router";

/** Catch-all: every unknown path renders the designed 404 through the root error boundary. */
export function loader() {
  throw data({ message: "Not found" }, { status: 404 });
}

export function action() {
  throw data({ message: "Not found" }, { status: 404 });
}

export default function NotFound() {
  return null;
}
