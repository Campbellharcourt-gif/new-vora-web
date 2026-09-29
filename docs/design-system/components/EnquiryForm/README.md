# EnquiryForm

The Start a project form: one column, four labelled sections, the existing fields and copy, one submit.

**Sections** (the existing field names):

- `01 — ABOUT YOU`: name, email, company, website.
- `02 — THE PROJECT`: project types, message (≤ 5,000 characters).
- `03 — BUDGET AND TIMING`: budget (shown only once ranges are approved — D15), timeline, target date (enabled by "By a specific date").
- `04 — FINALLY`: source and details, consent.

Then Turnstile, labelled "Security check", and **Send enquiry**.

**Errors:** a summary at the top with an ERROR label, the count and a link to each field. It takes focus (existing behaviour). Input is kept, including when the form token expires.

**Success:** the form is replaced in place by "Enquiry received / Thank you." with the reference in DM Mono, and focus moves to the heading.

**The hidden spam-trap field** stays hidden and out of the tab order.
