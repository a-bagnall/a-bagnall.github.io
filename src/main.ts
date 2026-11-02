type IntroLine =
  | { kind: "cmd"; text: string; typo?: string }
  | { kind: "out" | "ok"; text: string }
  | { kind: "progress"; text: string; ms: number };

const PROMPT = "austin@fedora:~/portfolio$ ";
const TYPE_DELAY_MS = 30;
const TYPE_JITTER_MS = 40;
const TYPO_NOTICE_MS = 450;
const BACKSPACE_DELAY_MS = 55;
const LINE_DELAY_MS = 200;
const BAR_WIDTH = 24;
const LEAVE_MS = 500; // keep in sync with the #intro opacity transition in style.css

// Headings that scramble in when their screen first comes into view; all are monospace so widths hold steady.
const SCRAMBLE_SELECTOR = ".block-title, .group, .projects a, .contact-label";
const SCRAMBLE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const SCRAMBLE_FRAME_MS = 40;
const SCRAMBLE_BASE_MS = 500;
const SCRAMBLE_STEP_MS = 70;
const SCRAMBLE_MAX_MS = 1800;

const FIRE_MIN_LEVEL = 0.75; // dimmest the flicker layer gets
const FIRE_SMOOTH_MS = 200; // how slowly the flicker eases toward each new random level
const POP_ATTACK_MS = 90; // how quickly a crackle swell rises
const POP_DECAY_MS = 300; // how quickly a crackle swell fades

const GLITCH_MIN_GAP_MS = 4000; // quietest stretch between glitches
const GLITCH_MAX_GAP_MS = 9000;
const GLITCH_HOLD_MS = 700; // how long the whole text stays as runes before resolving
const GLITCH_STEP_MS = 110; // time per letter to resolve back
const GLITCH_SELECTOR = "#nav .nav-label, .block-title, .group, .projects a";
const GLYPH = /[A-Za-z0-9]/;

class Skipped extends Error {}

function must<T extends Element>(selector: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`Missing required element: ${selector}`);
  return el;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
async function typeInto(
  el: HTMLElement,
  text: string,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<void> {
  for (const ch of text) {
    el.textContent = (el.textContent ?? "") + ch;
    await wait(TYPE_DELAY_MS + Math.random() * TYPE_JITTER_MS);
  }
}

// Parses "YYYY-MM" into a month count so timeline math works at month precision.
function readYearMonth(value: string | undefined, name: string): number {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value ?? "");
  if (!m) throw new Error(`${name} must look like YYYY-MM, got: ${value}`);
  return Number(m[1]) * 12 + (Number(m[2]) - 1);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatMonth(month: number): string {
  const name = MONTHS[month % 12];
  if (name === undefined) throw new Error(`Invalid month index: ${month}`);
  return `${name} ${Math.floor(month / 12)}`;
}

function currentMonth(): number {
  const now = new Date();
  return now.getFullYear() * 12 + now.getMonth();
}

// Like readYearMonth, but also accepts "now" for the current month.
function readMonthOrNow(value: string | undefined, name: string): number {
  return value === "now" ? currentMonth() : readYearMonth(value, name);
}

async function runIntro(): Promise<void> {
  const intro = must<HTMLElement>("#intro");
  const term = must<HTMLElement>("#intro-term");
  const skip = must<HTMLButtonElement>("#intro-skip");

  const finish = () => {
    intro.classList.add("done");
    document.body.classList.remove("intro-active");
  };

  const reduced = prefersReducedMotion();
  if (reduced) {
    finish();
    return;
  }

  let skipped = false;
  skip.addEventListener("click", () => {
    skipped = true;
    finish();
  });

  // Sleep, then abort the whole sequence if the person pressed skip meanwhile.
  const guard = async (ms: number) => {
    await sleep(ms);
    if (skipped) throw new Skipped();
  };

  const rawLines = must<HTMLScriptElement>("#intro-lines").textContent;
  if (rawLines === null) throw new Error("#intro-lines has no content");
  const lines = JSON.parse(rawLines) as IntroLine[];

  const playLine = async (line: IntroLine) => {
    const row = document.createElement("div");
    term.appendChild(row);

    if (line.kind === "out" || line.kind === "ok") {
      row.textContent = line.text;
      if (line.kind === "ok") row.className = "ok";
      await guard(LINE_DELAY_MS);
      return;
    }

    if (line.kind === "progress") {
      if (!(line.ms > 0)) throw new Error(`progress ms must be positive: ${line.text}`);
      const label = document.createElement("span");
      label.textContent = line.text;
      const bar = document.createElement("span");
      bar.className = "bar";
      row.append(label, bar);
      for (let i = 0; i <= BAR_WIDTH; i++) {
        const pct = Math.round((i / BAR_WIDTH) * 100);
        bar.textContent = ` [${"#".repeat(i)}${".".repeat(BAR_WIDTH - i)}] ${pct}%`;
        await guard(line.ms / BAR_WIDTH);
      }
      await guard(LINE_DELAY_MS);
      return;
    }

    if (line.kind === "cmd") {
      const prompt = document.createElement("span");
      prompt.className = "prompt";
      prompt.textContent = PROMPT;
      const typed = document.createElement("span");
      typed.className = "cursor";
      row.append(prompt, typed);

      if (line.typo) {
        await typeInto(typed, line.typo, guard);
        await guard(TYPO_NOTICE_MS);
        while ((typed.textContent ?? "").length > 0) {
          typed.textContent = (typed.textContent ?? "").slice(0, -1);
          await guard(BACKSPACE_DELAY_MS);
        }
      }
      await typeInto(typed, line.text, guard);
      typed.classList.remove("cursor");
      await guard(LINE_DELAY_MS);
      return;
    }

    throw new Error(`Unknown intro line kind: ${JSON.stringify(line)}`);
  };

  try {
    for (const line of lines) await playLine(line);
    await guard(LINE_DELAY_MS * 2);
    intro.classList.add("leaving");
    await guard(LEAVE_MS);
    finish();
  } catch (err) {
    if (err instanceof Skipped) return;
    throw err;
  }
}

function initTimelines(): void {
  for (const timeline of document.querySelectorAll<HTMLElement>(".timeline")) {
    const from = readYearMonth(timeline.dataset.from, "timeline data-from");
    const to = readMonthOrNow(timeline.dataset.to, "timeline data-to");
    if (to <= from) throw new Error("timeline data-to must be after data-from");

    must<HTMLElement>(".timeline-year-start", timeline).textContent = String(Math.floor(from / 12));
    must<HTMLElement>(".timeline-year-end", timeline).textContent =
      timeline.dataset.to === "now" ? "Now" : String(Math.floor(to / 12));

    const pctOf = (month: number, what: string): number => {
      const pct = ((month - from) / (to - from)) * 100;
      if (pct < 0 || pct > 100) throw new Error(`${what} is outside the timeline range`);
      return pct;
    };

    for (const node of timeline.querySelectorAll<HTMLElement>(".timeline-node")) {
      const start = readYearMonth(node.dataset.start, "timeline-node data-start");
      node.style.setProperty("--pos", `${pctOf(start, `Node start ${node.dataset.start}`).toFixed(2)}%`);

      // Tooltip text: ongoing when there is no data-end.
      let range: string;
      if (node.dataset.end === undefined) {
        range = `${formatMonth(start)} - Present`;
      } else {
        const end = readMonthOrNow(node.dataset.end, "timeline-node data-end");
        if (end < start) throw new Error(`Timeline node ends before it starts: ${node.dataset.start}`);
        pctOf(end, `Node end ${node.dataset.end}`);
        range = `${formatMonth(start)} - ${formatMonth(end)}`;
      }
      const dates = document.createElement("span");
      dates.className = "timeline-dates";
      dates.textContent = range;
      node.appendChild(dates);
    }
  }
}

// Shows the text as random Daedra runes for holdMs, then resolves letters left to right back to the real font.
// Each letter sits in a fixed-width cell so swapping fonts never shifts the layout.
async function runeCycle(el: HTMLElement, holdMs: number, stepMs: number): Promise<void> {
  const host = el.closest<HTMLElement>("a, h1, h2, h3") ?? el;
  host.setAttribute("aria-label", (host.textContent ?? "").trim());
  el.dataset.scrambling = "true";

  const cells: { cell: HTMLElement; ch: string }[] = [];
  const swaps: { node: Text; inserted: ChildNode[] }[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  const range = document.createRange();
  for (const node of nodes) {
    if (!GLYPH.test(node.data)) continue;
    const inserted: ChildNode[] = [];
    let word: HTMLElement | null = null; // words stay unbreakable so a wrapped heading never splits mid-word
    for (let i = 0; i < node.data.length; i++) {
      const ch = node.data[i]!;
      if (ch === " ") {
        inserted.push(document.createTextNode(" "));
        word = null;
        continue;
      }
      if (!word) {
        word = document.createElement("span");
        word.className = "glitch-word";
        inserted.push(word);
      }
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const cell = document.createElement("span");
      cell.className = "glitch-cell";
      cell.style.width = `${range.getBoundingClientRect().width}px`;
      cell.textContent = ch;
      word.append(cell);
      cells.push({ cell, ch });
    }
    swaps.push({ node, inserted });
  }
  for (const { node, inserted } of swaps) node.replaceWith(...inserted);

  const step = Math.min(stepMs, SCRAMBLE_MAX_MS / cells.length);
  const start = performance.now();
  for (;;) {
    const elapsed = performance.now() - start;
    const resolved = elapsed < holdMs ? 0 : Math.floor((elapsed - holdMs) / step) + 1;
    for (const [i, { cell, ch }] of cells.entries()) {
      const done = i < resolved || !GLYPH.test(ch);
      cell.textContent = done ? ch : SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)]!;
      cell.classList.toggle("rune", !done);
    }
    if (resolved >= cells.length) break;
    await sleep(SCRAMBLE_FRAME_MS);
  }

  for (const { node, inserted } of swaps) {
    inserted[0]!.before(node);
    for (const n of inserted) n.remove();
  }
  host.removeAttribute("aria-label");
  delete el.dataset.scrambling;
}

// Headings stay hidden until their section is about to show, then scramble in once.
function initScramble(sections: HTMLElement[]): void {
  if (prefersReducedMotion()) return;
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        for (const el of entry.target.querySelectorAll<HTMLElement>(SCRAMBLE_SELECTOR)) {
          el.classList.remove("scramble-pending");
          void runeCycle(el, SCRAMBLE_BASE_MS, SCRAMBLE_STEP_MS);
        }
      }
    },
    { rootMargin: "0px 0px -15% 0px" },
  );
  for (const section of sections) {
    for (const el of section.querySelectorAll(SCRAMBLE_SELECTOR)) el.classList.add("scramble-pending");
    observer.observe(section);
  }
}

function initSections(): void {
  const sections = [...document.querySelectorAll<HTMLElement>("[data-section]")];
  if (sections.length === 0) throw new Error("No [data-section] elements found");
  initScramble(sections);

  const links = [...document.querySelectorAll<HTMLAnchorElement>("a[data-nav]")];
  const dotsList = must<HTMLOListElement>("#dots");
  const dots = new Map<string, HTMLButtonElement>();

  const iconOf = (section: HTMLElement): string => {
    const icon = section.dataset.icon;
    if (!icon) throw new Error(`Section #${section.id} is missing data-icon`);
    return icon;
  };

  const goTo = (id: string, smooth: boolean) => {
    const target = document.getElementById(id);
    if (!target) throw new Error(`No section with id: ${id}`);
    target.scrollIntoView({ behavior: smooth ? "smooth" : "auto" });
    history.replaceState(null, "", `#${id}`);
  };

  for (const section of sections) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("aria-label", section.id);
    btn.title = section.id;
    btn.textContent = iconOf(section);
    btn.addEventListener("click", () => goTo(section.id, true));
    li.appendChild(btn);
    dotsList.appendChild(li);
    dots.set(section.id, btn);
  }

  for (const link of links) {
    const target = sections.find((s) => s.id === link.hash.slice(1));
    if (!target) throw new Error(`Nav link has no section: ${link.hash}`);
    must<HTMLElement>(".nav-index", link).textContent = iconOf(target);
    link.addEventListener("click", (ev) => {
      ev.preventDefault();
      goTo(link.hash.slice(1), true);
    });
  }

  const setActive = (id: string) => {
    for (const [sid, btn] of dots) btn.classList.toggle("active", sid === id);
    for (const link of links) link.classList.toggle("active", link.hash === `#${id}`);
  };

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) setActive(entry.target.id);
      }
    },
    { rootMargin: "-50% 0px -50% 0px" }, // the section crossing mid-screen is active, even when taller than the viewport
  );
  sections.forEach((s) => observer.observe(s));

  if (location.hash.length > 1) goTo(location.hash.slice(1), false);
}

// Reduced-motion users get paused videos with controls; everyone else only plays them while on screen.
function initVideos(): void {
  const videos = document.querySelectorAll<HTMLVideoElement>("video[autoplay]");
  if (prefersReducedMotion()) {
    for (const video of videos) {
      video.pause();
      video.controls = true;
    }
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const video = entry.target as HTMLVideoElement;
      if (entry.isIntersecting) void video.play();
      else video.pause();
    }
  });
  for (const video of videos) observer.observe(video);
}

// Gently flickers the fire glow and swells short crackle pops, sometimes in bursts; nothing snaps or jumps.
function initFire(): void {
  if (prefersReducedMotion()) return;
  const flicker = must<HTMLElement>(".glow-flicker");
  const crackle = must<HTMLElement>(".glow-crackle");

  let level = 0.9;
  let target = level;
  let nextTarget = 0;
  let pop = 0;
  let popTarget = 0;
  let nextPop = 0;
  let burstLeft = 0;
  let last = performance.now();

  const frame = (now: number) => {
    const dt = Math.min(now - last, 100);
    last = now;

    if (now >= nextTarget) {
      target = FIRE_MIN_LEVEL + Math.random() * (1 - FIRE_MIN_LEVEL);
      nextTarget = now + 120 + Math.random() * 250;
    }
    level += (target - level) * (1 - Math.exp(-dt / FIRE_SMOOTH_MS));

    if (now >= nextPop) {
      popTarget = 0.4 + Math.random() * 0.6;
      if (burstLeft > 0) {
        burstLeft--;
        nextPop = now + 100 + Math.random() * 120;
      } else {
        nextPop = now + 400 + Math.random() * 1500;
        if (Math.random() < 0.4) burstLeft = 1 + Math.floor(Math.random() * 2);
      }
    }
    pop += (popTarget - pop) * (1 - Math.exp(-dt / POP_ATTACK_MS));
    popTarget *= Math.exp(-dt / POP_DECAY_MS);

    flicker.style.opacity = String(Math.min(1, level + pop * 0.15));
    flicker.style.transform = `scale(${1 + (level - 0.9) * 0.1})`;
    crackle.style.opacity = String(pop);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// Menu labels scramble in once the intro ends; after that, every so often, a label or heading turns back into runes.
function initGlitch(): void {
  if (prefersReducedMotion()) return;
  for (const link of document.querySelectorAll<HTMLAnchorElement>("#nav nav a")) {
    const text = [...link.childNodes].find((n): n is Text => n instanceof Text && n.data.trim() !== "");
    if (!text) throw new Error(`Nav link has no label text: ${link.href}`);
    const label = document.createElement("span");
    label.className = "nav-label";
    label.textContent = text.data.trim();
    text.replaceWith(" ", label);
    void runeCycle(label, SCRAMBLE_BASE_MS, SCRAMBLE_STEP_MS);
  }

  // Skips text that is off screen or still scrambling in.
  const pickTarget = (): HTMLElement | undefined => {
    const ready = [...document.querySelectorAll<HTMLElement>(GLITCH_SELECTOR)].filter((el) => {
      const r = el.getBoundingClientRect();
      const onScreen = r.width > 0 && r.bottom > 0 && r.top < window.innerHeight;
      return onScreen && !el.classList.contains("scramble-pending") && el.dataset.scrambling === undefined;
    });
    return ready[Math.floor(Math.random() * ready.length)];
  };

  const schedule = () => {
    const gap = GLITCH_MIN_GAP_MS + Math.random() * (GLITCH_MAX_GAP_MS - GLITCH_MIN_GAP_MS);
    setTimeout(async () => {
      const target = document.hidden ? undefined : pickTarget();
      if (target) await runeCycle(target, GLITCH_HOLD_MS, GLITCH_STEP_MS);
      schedule();
    }, gap);
  };
  schedule();
}

// The hero is blanked up front so it can be typed once the intro overlay is gone.
async function main(): Promise<void> {
  const h1 = must<HTMLElement>(".hero h1");
  const text = h1.textContent ?? "";
  const animate = !prefersReducedMotion();
  initVideos();
  if (animate) {
    h1.setAttribute("aria-label", text);
    h1.textContent = "";
    h1.classList.add("cursor"); // its ::after also keeps the h1 from collapsing while empty
  }
  await runIntro();
  initSections(); // after the intro so headings scramble in where they can be seen
  initGlitch();
  initFire();
  if (animate) await typeInto(h1, text);
}

void main();
initTimelines();
