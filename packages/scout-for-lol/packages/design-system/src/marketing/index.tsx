import type { HTMLAttributes, ReactNode } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "#src/components/accordion.tsx";
import { Button } from "#src/components/button.tsx";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "#src/components/card.tsx";
import {
  Cluster,
  Container,
  Grid,
  Section,
  Stack,
} from "#src/layout/index.tsx";
import { cn } from "#src/lib/cn.ts";

export function Hero(props: {
  eyebrow?: ReactNode;
  title: ReactNode;
  titleLevel?: "h1" | "h2";
  description: ReactNode;
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
  media?: ReactNode;
}) {
  const Heading = props.titleLevel === "h2" ? "h2" : "h1";
  return (
    <Section className="scout-hero">
      <Container>
        <div className="scout-hero__grid">
          <Stack>
            {props.eyebrow}
            <Heading>{props.title}</Heading>
            <div className="scout-hero__description">{props.description}</div>
            <Cluster>
              {props.primaryAction}
              {props.secondaryAction}
            </Cluster>
          </Stack>
          {props.media === undefined ? null : (
            <div className="scout-hero__media">{props.media}</div>
          )}
        </div>
      </Container>
    </Section>
  );
}

export function CTA(props: {
  title: ReactNode;
  description?: ReactNode;
  action: ReactNode;
}) {
  return (
    <Section>
      <Container>
        <div className="scout-cta scout-panel">
          <Stack>
            <h2>{props.title}</h2>
            {props.description}
          </Stack>
          {props.action}
        </div>
      </Container>
    </Section>
  );
}

export function FeatureCard(props: {
  icon?: ReactNode;
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        {props.icon}
        <CardTitle>{props.title}</CardTitle>
      </CardHeader>
      <CardContent>{props.children}</CardContent>
    </Card>
  );
}
export const BenefitCard = FeatureCard;
export const StatCard = FeatureCard;
export function FeatureGrid(props: { children: ReactNode }) {
  return <Grid>{props.children}</Grid>;
}

export function ProcessStep(props: {
  number: number | string;
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="scout-process-step">
      <span className="scout-badge scout-badge--primary">{props.number}</span>
      <Stack>
        <h3>{props.title}</h3>
        {props.children}
      </Stack>
    </div>
  );
}

export function FAQItem(props: {
  value: string;
  question: ReactNode;
  children: ReactNode;
}) {
  return (
    <Accordion type="single" collapsible>
      <AccordionItem value={props.value}>
        <AccordionTrigger>{props.question}</AccordionTrigger>
        <AccordionContent>{props.children}</AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

export function GalleryItem(props: { image: ReactNode; caption?: ReactNode }) {
  return (
    <figure className="scout-gallery-item scout-card">
      {props.image}
      {props.caption === undefined ? null : (
        <figcaption>{props.caption}</figcaption>
      )}
    </figure>
  );
}

export function ImageFeature(props: {
  image: ReactNode;
  title: ReactNode;
  children: ReactNode;
  reverse?: boolean;
}) {
  return (
    <div
      className="scout-image-feature"
      data-reverse={props.reverse === true ? "true" : undefined}
    >
      <div>{props.image}</div>
      <Stack>
        <h2>{props.title}</h2>
        {props.children}
      </Stack>
    </div>
  );
}

export function AnnouncementBanner(props: {
  children: ReactNode;
  href?: string;
}) {
  const content = <div className="scout-announcement">{props.children}</div>;
  return props.href === undefined ? (
    content
  ) : (
    <a href={props.href}>{content}</a>
  );
}

export function SectionHeader({
  className,
  ...props
}: HTMLAttributes<HTMLElement>) {
  return (
    <header className={cn("scout-section-header", className)} {...props} />
  );
}

export function MarketingButton(props: {
  href: string;
  children: ReactNode;
  secondary?: boolean;
  analyticsEvent?: string;
}) {
  return (
    <Button asChild variant={props.secondary === true ? "outline" : "default"}>
      <a href={props.href} data-analytics-event={props.analyticsEvent}>
        {props.children}
      </a>
    </Button>
  );
}
