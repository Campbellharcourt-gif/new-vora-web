import { Link } from "react-router";
import { EmptyState, PageHeading } from "~/components/workspace/WorkspaceShell";

export default function MemberHome() {
  return (
    <>
      <PageHeading eyebrow="Members" title="Welcome" />
      <EmptyState>
        Member features will appear here as they launch. Manage your sign-in and sessions in{" "}
        <Link to="/account/security">account security</Link>.
      </EmptyState>
    </>
  );
}
