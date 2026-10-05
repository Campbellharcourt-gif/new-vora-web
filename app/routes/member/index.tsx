import { Link } from "react-router";
import { EmptyState, PageHeading, WelcomeNotice } from "~/components/workspace/WorkspaceShell";

export default function MemberHome() {
  return (
    <>
      <PageHeading eyebrow="Members" title="Welcome" />
      <WelcomeNotice>Your VORA member account is ready.</WelcomeNotice>
      <EmptyState>
        Member features will appear here as they launch. Manage your sign-in and sessions in{" "}
        <Link className="v-link" to="/account/security">
          account security
        </Link>
        .
      </EmptyState>
    </>
  );
}
