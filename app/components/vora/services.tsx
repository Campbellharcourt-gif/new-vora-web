import type { CSSProperties, ReactNode } from "react";
import { ArrowRight } from "./icons";
import { Label, SiteLink, Slot } from "./primitives";

/**
 * Service and process components (design system §7.4). The delivery label states who does the
 * work, exactly as decision C2/D4 requires.
 */

export type DeliveryModel = "vora" | "partner" | "joint";

export function deliveryLabel(model: string): string {
  if (model === "partner") return "Creative by Solara Studios · Digital by VORA";
  if (model === "joint") return "VORA × Solara Studios";
  return "Delivered by VORA";
}

export interface ServiceCard {
  slug: string;
  name: string;
  summary: string | null;
  deliveryModel: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The services as editorial rows between hairlines: index, name, summary, label, arrow. */
export function ServiceList({ services }: { services: readonly ServiceCard[] }) {
  return (
    <ul className="v-services">
      {services.map((s, i) => (
        <li className="v-service" key={s.slug} data-reveal="">
          <SiteLink to={`/services/${s.slug}`}>
            <span className="v-label">{pad(i + 1)}</span>
            <span className="v-service__name">
              <span className="v-mask">
                <span>{s.name}</span>
              </span>
            </span>
            <span className="v-service__text v-fade" style={{ "--i": 1 } as CSSProperties}>
              {s.summary ? <span className="v-body">{s.summary}</span> : null}
              <span className="v-label">{deliveryLabel(s.deliveryModel)}</span>
            </span>
            <ArrowRight />
          </SiteLink>
        </li>
      ))}
    </ul>
  );
}

/**
 * VORA's six real process steps (Mark4, recorded in the Our Story content and the design
 * system §7.4). No invented durations or numbers.
 */
export const PROCESS_STEPS = [
  "Discover",
  "Define",
  "Design",
  "Develop",
  "Refine",
  "Launch",
] as const;

/**
 * ProcessLine: six ticks on one survey line — horizontal on desktop, vertical on mobile. Each
 * tick lights (accent) as it is reached; in reduced motion the line is static.
 */
export function ProcessLine({
  steps = PROCESS_STEPS,
  label = "How we work",
  notes,
}: {
  steps?: readonly string[];
  label?: string;
  /** Optional one sentence per step; a copy slot until written. */
  notes?: readonly ReactNode[];
}) {
  return (
    <ol className="v-process" aria-label={label}>
      {steps.map((step, i) => (
        <li key={step} data-reveal="" style={{ "--i": i } as CSSProperties}>
          <Label as="span">{pad(i + 1)}</Label>
          <span className="v-heading-s">{step}</span>
          {notes?.[i] ? <span className="v-body-s">{notes[i]}</span> : null}
        </li>
      ))}
    </ol>
  );
}

/** A partner-delivered service's "who does what" split (§16.5) — copy slots until approved. */
export function WhoDoesWhat({ model }: { model: string }) {
  if (model === "vora") {
    return (
      <div className="v-split">
        <div>
          <Label>Delivered by VORA</Label>
          <p className="v-body">
            <Slot>What VORA does end to end — copy slot</Slot>
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="v-split">
      <div>
        <Label>Creative by Solara</Label>
        <p className="v-body">
          <Slot>Solara Studios' responsibilities — copy slot (needs VORA and Solara approval)</Slot>
        </p>
      </div>
      <div>
        <Label>Digital by VORA</Label>
        <p className="v-body">
          <Slot>VORA's responsibilities — copy slot (needs VORA and Solara approval)</Slot>
        </p>
      </div>
    </div>
  );
}
