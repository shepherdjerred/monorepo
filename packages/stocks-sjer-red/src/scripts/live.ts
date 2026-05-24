// Client-side "live" feel: ticking unit prices, line totals, portfolio
// aggregates, and ticker-tape entries. Drifts ±0.3% off the static base
// price every ~700ms. Purely cosmetic — historical data is untouched.

interface Position {
  ticker: string;
  base: number;
  start: number;
  qty: number;
  current: number;
}

function fmtUsd(
  n: number,
  opts: { cents?: boolean; signed?: boolean } = {},
): string {
  const { cents = false, signed = false } = opts;
  const sign = signed && n >= 0 ? "+" : "";
  return (
    sign +
    n.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: cents ? 2 : 0,
      maximumFractionDigits: cents ? 2 : 0,
    })
  );
}

function fmtPct(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function readNum(el: HTMLElement, attr: string): number {
  const raw = el.getAttribute(attr);
  if (raw === null) throw new Error(`missing ${attr} on element`);
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) throw new Error(`bad ${attr}=${raw}`);
  return n;
}

function flash(el: Element, up: boolean): void {
  el.classList.remove("flash-up", "flash-down");
  // force reflow so re-adding the class restarts the animation
  void (el as HTMLElement).offsetWidth;
  el.classList.add(up ? "flash-up" : "flash-down");
}

function setColor(el: HTMLElement, n: number): void {
  el.style.color =
    n === 0
      ? "var(--color-muted)"
      : n > 0
        ? "var(--color-up)"
        : "var(--color-down)";
}

function initPositions(): Map<string, Position> {
  const positions = new Map<string, Position>();
  document.querySelectorAll<HTMLElement>("[data-position]").forEach((el) => {
    const ticker = el.dataset.position;
    if (ticker === undefined || ticker === "") return;
    const base = readNum(el, "data-base-price");
    positions.set(ticker, {
      ticker,
      base,
      start: readNum(el, "data-start-price"),
      qty: readNum(el, "data-qty"),
      current: base,
    });
  });
  return positions;
}

function updatePosition(p: Position, next: number): void {
  const isUp = next >= p.current;
  p.current = next;

  const lineTotal = next * p.qty;
  const pct = ((next - p.start) / p.start) * 100;

  document
    .querySelectorAll<HTMLElement>(`[data-position="${p.ticker}"]`)
    .forEach((row) => {
      row.querySelectorAll<HTMLElement>("[data-price]").forEach((el) => {
        el.textContent = fmtUsd(next, { cents: true });
        flash(el, isUp);
      });
      row.querySelectorAll<HTMLElement>("[data-line]").forEach((el) => {
        el.textContent = fmtUsd(lineTotal);
      });
      row.querySelectorAll<HTMLElement>("[data-chg]").forEach((el) => {
        el.textContent = fmtPct(pct);
        setColor(el, pct);
      });
    });
}

function updatePortfolio(positions: Map<string, Position>): void {
  let mark = 0;
  let basis = 0;
  for (const p of positions.values()) {
    mark += p.current * p.qty;
    basis += p.start * p.qty;
  }
  const pnl = mark - basis;
  const pct = (pnl / basis) * 100;

  document
    .querySelectorAll<HTMLElement>("[data-portfolio-mark]")
    .forEach((el) => {
      el.textContent = fmtUsd(mark);
    });
  document
    .querySelectorAll<HTMLElement>("[data-portfolio-pnl]")
    .forEach((el) => {
      el.textContent = fmtUsd(pnl, { signed: true });
    });
  document
    .querySelectorAll<HTMLElement>("[data-portfolio-pct]")
    .forEach((el) => {
      el.textContent = `(${fmtPct(pct)})`;
    });
  document
    .querySelectorAll<HTMLElement>("[data-portfolio-pnl-block]")
    .forEach((el) => {
      setColor(el, pnl);
    });
  document
    .querySelectorAll<HTMLElement>("[data-portfolio-pnl-value]")
    .forEach((el) => {
      setColor(el, pnl);
    });
}

function tickOnce(positions: Map<string, Position>): void {
  const list = [...positions.values()];
  if (list.length === 0) return;
  const idx = Math.floor(Math.random() * list.length);
  const p = list[idx];
  if (p === undefined) return;
  const drift = (Math.random() - 0.5) * 0.006; // ±0.3%
  // pull gently back toward base so we don't wander forever
  const pull = (p.base - p.current) / p.base / 50;
  const factor = 1 + drift + pull;
  const next = Math.max(0.01, p.current * factor);
  updatePosition(p, next);
  updatePortfolio(positions);
}

function startClock(): void {
  const el = document.querySelector<HTMLElement>("[data-live-clock]");
  if (!el) return;
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const tick = (): void => {
    el.textContent = `${fmt.format(new Date())} PT`;
  };
  tick();
  setInterval(tick, 1000);
}

function start(): void {
  startClock();
  const positions = initPositions();
  if (positions.size === 0) return;
  const schedule = (): void => {
    tickOnce(positions);
    const delay = 1500 + Math.random() * 2000; // 1.5–3.5s
    setTimeout(schedule, delay);
  };
  schedule();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}
