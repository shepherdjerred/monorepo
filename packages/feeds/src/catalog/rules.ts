import type {
  AutoReadRule,
  SingleAutoReadRule,
} from "@shepherdjerred/feeds/shared/contract.ts";

export const PRERELEASE_RULE: SingleAutoReadRule = {
  field: "title",
  pattern: String.raw`\b(alpha|beta|rc\d*|canary|dev|development[- ]snapshot|snapshot|nightly|preview|insiders|pre)\b`,
  flags: "i",
};

export const PATCH_VERSION_RULE: SingleAutoReadRule = {
  field: "title",
  pattern: String.raw`^[^\d]*\bv?\d+\.\d+\.[1-9]\d*\b`,
  flags: "i",
};

export const SUBMODULE_RELEASE_RULE: SingleAutoReadRule = {
  field: "title",
  pattern: String.raw`^(?:@[a-z0-9_-]+\/[a-z0-9_.-]+|[a-z0-9_.-]+\/[a-z0-9_./-]+|stable:)`,
  flags: "i",
};

export const STRICT_RELEASE_RULES: AutoReadRule = [
  PRERELEASE_RULE,
  SUBMODULE_RELEASE_RULE,
  PATCH_VERSION_RULE,
];

export const BLOG_PRERELEASE_RULE: SingleAutoReadRule = {
  field: "title",
  pattern: String.raw`\b(alpha|beta|rc\s*\d*|release candidate|canary)\b`,
  flags: "i",
};

export const AI_SDK_ONLY_RULE: SingleAutoReadRule = {
  field: "title",
  pattern: String.raw`\bAI SDK\b`,
  flags: "i",
  negate: true,
};

export const OPENAI_NOISE_RULES: AutoReadRule = [
  {
    field: "category",
    pattern:
      "^(?:Webinars?|Startup|Global Affairs|Company|AI Adoption|Applied AI|OpenAI Academy|Guides|Demos|Intelligence Age)$",
    flags: "i",
  },
  {
    field: "url",
    pattern: String.raw`openai\.com\/(?:business|global-affairs|ads|form|policies|brand)\/`,
    flags: "i",
  },
  {
    field: "title",
    pattern: String.raw`(?:\bstrategic partnership\b|\bpartners? with OpenAI\b|\band OpenAI (?:announce |launch )?partner|\blaunch [£$€]?\d+[mbk]? partnership\b|\bcase study\b|\bcustomer story\b|\bROI\b|\bsales teams?\b|\bin-house legal\b|\bfor (?:Law|Sales|Healthcare|Government|Education|Nonprofits|Veterans|Enterprises|Chile|India|Europe|Japan|Germany|France|UK)\b|\bhealthcare teams\b|\bBusinesses in ChatGPT\b|\bChatGPT (?:Wallet|Enterprise|Business|Edu|Ads)\b|\bChatGPT Plus for veterans\b|\bAWS (?:Marketplace|GovCloud)\b|\bappoints\b|\bjoins OpenAI\b|\bto acquire\b|\bBoard of Directors\b|\bEconomic Blueprint\b|\bglobal affairs\b|\bwebinar\b|\bworkshop\b|\bin everyday life\b|\bguidance gap in education\b|\bAI-native graduates\b|\bchildren[’']s safety\b|\bonline child\b|\bNATO and allied\b|\bresponsible AI infrastructure\b|\beffect on freelance work\b|\bnew blog for science\b|\bBroadening access to AI\b)`,
    flags: "i",
  },
  {
    field: "title",
    pattern: String.raw`(?:^How (?!OpenAI\b|we\b|our\b)[A-Z][\w.&+' -]{1,40} (?:scales?|uses?|builds?|automates?|transforms?|cuts?|accelerates?|brings?|turns?|delivers?|powers?|reimagines?|modernizes?|streamlines?|defends?|ships?|raises?|helped|is developing)\b|^[A-Z][\w.&+' -]{1,35} (?:(?:helps|achieves|scales|automates|transforms|reimagines|rethinks|elevates|delivers|uses OpenAI|is changing|is rethinking|is developing|searches \d+|doubles revenue|sees improvements|grows product)\b|builds [\w -]+ with (?:OpenAI|Codex|ChatGPT)\b)|\bchief architect on AI\b)`,
    flags: "",
  },
];

export const CLOUDFLARE_NOISE_RULES: AutoReadRule = [
  {
    field: "category",
    pattern:
      "^(?:Managed Rules|Cloudflare for Campaigns|Athenian Project|Project Galileo|Policy & Legal|Billing)$",
    flags: "i",
  },
  {
    field: "title",
    pattern: String.raw`(?:^How Cloudflare WAF (?:helps )?protects? against\b|DDoS Threat Report|Internet traffic and attacks during|Election|Project Galileo|Athenian Project|\bSpend Management\b|Ecosystem Fund|withdrawal from France|\bwebinar\b|\bcase study\b)`,
    flags: "i",
  },
];

export const PRISMA_NOISE_RULES: AutoReadRule = [
  {
    field: "title",
    pattern: String.raw`(?:\balternatives\b|\bvs\.?\b|\bcompared\b|Best hosting|Where to host|first 100 paying users|available in n8n|ChatGPT Plugin|Prisma ORM Manifesto|How to use Prisma ORM \d+ in NestJS|Host a test version without replacing production|\bcase study\b|\bwebinar\b)`,
    flags: "i",
  },
];

export const GRAFANA_NOISE_RULES: AutoReadRule = [
  {
    field: "title",
    pattern: String.raw`(?:\bObservabilityCON\b|\bGrafanaCON\b|Executive Briefing Center|stories from Unprompted|Spend less time on operational busywork|Any agent anywhere: How to use Grafana Cloud|Agent Observability FAQ:|Instrumentation Hub in Grafana Cloud|\bcustomer story\b|\bcase study\b|\bwebinar\b)`,
    flags: "i",
  },
];

export const POSTHOG_NOISE_RULES: AutoReadRule = [
  {
    field: "title",
    pattern: String.raw`(?:customer success|lifecycle marketing|billboard campaign|for new paid plans|fixed the pricing|\bpricing\b|\bcase study\b)`,
    flags: "i",
  },
];

export const OTEL_NOISE_RULES: AutoReadRule = [
  {
    field: "title",
    pattern:
      "(?:blog policy|Community Award|KubeCon|FOSDEM|OTel Unplugged|Governance Committee|Election Results|observability journey|case for OpenTelemetry maintainership|Help us understand how you use)",
    flags: "i",
  },
];

export const KUBERNETES_NOISE_RULES: AutoReadRule = [
  BLOG_PRERELEASE_RULE,
  {
    field: "title",
    pattern: String.raw`(?:\bSpotlight on SIG\b|spotlight on AI Conformance|Conformance Working Group|KubeCon|Contributor Summit)`,
    flags: "i",
  },
];

export const TAILSCALE_BLOG_NOISE_RULES: AutoReadRule = [
  {
    field: "title",
    pattern: String.raw`(?:why digital security matters in the outdoors|when I was at university|router VPN might be more trouble|Grok Bot has a Tailscale integration|Sovereign AI starts with open infrastructure|\bwebinar\b|\bcustomer story\b|\bcase study\b)`,
    flags: "i",
  },
];

export const DUCKDB_NOISE_RULES: AutoReadRule = [
  {
    field: "category",
    pattern: "^case-study$",
    flags: "i",
  },
  {
    field: "title",
    pattern: String.raw`(?:^How [A-Z][\w.&' -]+ (?:Cut|Built|Scaled|Uses|Moved|Migrated)\b|User Group Workshop|Quant's Desktop|Doesn[’']t Need a Database Server)`,
    flags: "",
  },
];

export const ASTRO_NOISE_RULES: AutoReadRule = [
  {
    field: "url",
    pattern: String.raw`\/case-studies\/`,
    flags: "i",
  },
  {
    field: "title",
    pattern: String.raw`(?:^What['’]s new in Astro\s*-\s*\w+\s+\d{4}\b|Affordable and Fast Migration)`,
    flags: "i",
  },
];

export const HOME_ASSISTANT_NOISE_RULES: AutoReadRule = [
  {
    field: "title",
    pattern: String.raw`(?:joins Works with Home Assistant|\bCommunity Day\b|What the Heck|Starter Kit|survey dataset)`,
    flags: "i",
  },
];

export const INTELLIJ_NOISE_RULES: AutoReadRule = [
  {
    field: "category",
    pattern:
      "^(?:bug-fix-update|java-annotated(?:-monthly)?|case-stud(?:y|ies))$",
    flags: "i",
  },
  {
    field: "title",
    pattern: String.raw`(?:\bEAP\b|\bRC\b|\bBeta\b|Java Annotated Monthly|What['’]s fixed in|Forrester|\bROI\b|\bLivestream\b|\bWebinar\b|\b20\d{2}\.\d+\.[1-9]\d*\b)`,
    flags: "i",
  },
];
