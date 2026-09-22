/**
 * The technology universe: a Matter.js simulation rendered on a single
 * canvas. React never mounts a component per block; it drives this scene
 * through an imperative API and receives hover/click callbacks.
 */
import Matter from "matter-js";
import type { ArchitectureGroup, UniverseTech } from "@/lib/types";

const { Engine, Bodies, Body, Composite, Mouse, MouseConstraint, Events, Runner, Query, Sleeping } = Matter;

export type SceneTech = UniverseTech;

export interface StackBlockSpec {
  slotId: string;
  group: ArchitectureGroup;
  tech: SceneTech;
  label?: string;
}

export interface SceneCallbacks {
  onHover?: (info: { kind: "pile"; tech: SceneTech } | { kind: "stack"; slotId: string; tech: SceneTech } | null) => void;
  onClick?: (info: { kind: "pile"; tech: SceneTech } | { kind: "stack"; slotId: string; tech: SceneTech }) => void;
  onSettled?: () => void;
}

interface BlockMeta {
  kind: "pile" | "stack";
  tech: SceneTech;
  size: number;
  slotId?: string;
  group?: ArchitectureGroup;
  glow: number; // 0..1 highlight intensity
  glowColor: string;
  born: number;
  stale?: boolean;
  fadeOut?: number;
}

type MBody = Matter.Body & { meta?: BlockMeta };

/**
 * A block in flight from the pile to its slot. Motion is true projectile motion:
 * constant horizontal velocity and constant downward acceleration, solved so the block
 * arrives just above its slot while falling, then hands over to the physics engine.
 */
interface Flight {
  t0: number;
  duration: number; // ms
  from: { x: number; y: number };
  v0: { x: number; y: number }; // px/ms
  g: number; // px/ms²
  aim: { x: number; y: number }; // target the arc was solved for
  slotId: string;
  group: ArchitectureGroup;
  sizeFrom: number;
  sizeTo: number;
  angleFrom: number;
  spin: number;
  fadeIn: boolean;
  trail: Array<{ x: number; y: number; angle: number; size: number }>;
}

/** Physics engine step length in ms (Matter's default runner delta). */
const STEP_MS = 1000 / 60;

export const GROUP_ORDER: ArchitectureGroup[] = ["EXPERIENCE", "API", "DATA", "AI", "INGESTION", "INFRASTRUCTURE"];
const GROUP_COLORS: Record<ArchitectureGroup, string> = {
  EXPERIENCE: "#8ab4ff",
  API: "#9ef0c6",
  DATA: "#ffd27a",
  AI: "#f39cff",
  INGESTION: "#ffab91",
  INFRASTRUCTURE: "#a8b3c7",
};

/** Collision categories: pile 0x0001, walls 0x0004, one bit per architecture row from 0x0010. */
const CAT_PILE = 0x0001;
const CAT_WALL = 0x0004;
const rowCategory = (group: ArchitectureGroup) => 0x0010 << GROUP_ORDER.indexOf(group);

export interface SceneOptions {
  reducedMotion: boolean;
}

interface Shelf {
  group: ArchitectureGroup;
  y: number;
  left: number;
  right: number;
  bodies: MBody[];
  slots: string[];
  statics?: Matter.Body[];
}

export class UniverseScene {
  // Settled bodies sleep, so an idle universe costs almost nothing to simulate.
  private engine = Engine.create({ gravity: { x: 0, y: 1.1, scale: 0.001 }, enableSleeping: true });
  private sprites = new Map<string, HTMLCanvasElement>();
  private flights = new Map<MBody, Flight>();
  private launchQueue: Array<() => void> = [];
  private lastLaunch = 0;
  private runner = Runner.create();
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private width = 0;
  private height = 0;
  private walls: Matter.Body[] = [];
  private pile: MBody[] = [];
  private stack = new Map<string, MBody>();
  private shelves = new Map<ArchitectureGroup, Shelf>();
  private techs: SceneTech[] = [];
  private paths = new Map<string, Path2D>();
  private favicons = new Map<string, HTMLImageElement | null>();
  private raf = 0;
  private hover: MBody | null = null;
  private mouseConstraint?: Matter.MouseConstraint;
  private edges: Array<{ from: string; to: string }> = [];
  private mode: "idle" | "building" | "complete" = "idle";
  private settledFired = false;
  private pileTarget = 0;
  private spawnQueue: SceneTech[] = [];
  private lastSpawn = 0;
  private pointer = { x: -1, y: -1, down: false, moved: false };
  private destroyed = false;
  private labels: Array<{ group: ArchitectureGroup; y: number; x: number }> = [];
  private highlightQuery = "";
  private topInset = 180;

  constructor(
    private canvas: HTMLCanvasElement,
    private callbacks: SceneCallbacks,
    private options: SceneOptions,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    this.ctx = ctx;
    if (options.reducedMotion) this.engine.gravity.y = 0;
    this.resize();
    this.bindPointer();
    Events.on(this.engine, "afterUpdate", () => this.stepFlights(performance.now()));
    Runner.run(this.runner, this.engine);
    const loop = () => {
      if (this.destroyed) return;
      this.tick();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------

  setTechnologies(techs: SceneTech[], count: number) {
    this.techs = techs;
    // Keep the settled pile to roughly the bottom third of the viewport, whatever its size.
    const size = this.pileSize();
    const areaFit = Math.floor((this.width / size) * ((this.height * 0.26) / size) * 1.15);
    this.pileTarget = Math.min(count, techs.length, Math.max(40, areaFit));
    for (const b of this.pile) Composite.remove(this.engine.world, b);
    this.pile = [];
    const shuffled = [...techs].sort(() => Math.random() - 0.5).slice(0, this.pileTarget);
    this.spawnQueue = shuffled;
    if (this.options.reducedMotion) {
      this.spawnQueue = [];
      for (const t of shuffled) {
        const b = this.makeBlock(t, "pile", this.pileSize(), -100, -100);
        Body.setAngle(b, 0);
        Body.setStatic(b, true);
        this.pile.push(b);
      }
      this.layoutStaticPile();
    }
  }

  /** Pixels reserved at the top for the docked command bar and status (measured by React). */
  setTopInset(px: number) {
    if (Math.abs(px - this.topInset) < 4) return;
    this.topInset = px;
    if (this.shelves.size) this.layoutShelves();
  }

  setHighlightQuery(q: string) {
    this.highlightQuery = q.trim().toLowerCase();
  }

  /** Glow candidate blocks in the pile briefly (search phase). */
  highlight(techIds: string[], color = "#ffffff") {
    const set = new Set(techIds);
    for (const b of this.pile) {
      if (b.meta && set.has(b.meta.tech.id)) {
        b.meta.glow = 1;
        b.meta.glowColor = color;
        if (!this.options.reducedMotion && !b.isStatic) {
          this.wake(b);
          Body.applyForce(b, b.position, { x: 0, y: -0.004 * b.mass });
        }
      }
    }
  }

  flash(techId: string, color: string) {
    for (const b of this.pile) {
      if (b.meta?.tech.id === techId) {
        b.meta.glow = 0.8;
        b.meta.glowColor = color;
      }
    }
  }

  /**
   * "Shake off" the current stack at the start of a follow-up: every block jolts loose and dims
   * while TypeSafe re-decides. Re-selected blocks brighten and settle back; the rest drop into the
   * pile when the build finishes.
   */
  shakeOff() {
    this.mode = "building";
    this.settledFired = false;
    this.edges = [];
    const now = performance.now();
    for (const b of this.stack.values()) {
      if (!b.meta) continue;
      b.meta.stale = true;
      b.meta.born = now; // lets the fall play out before rows re-organize
      b.meta.glow = 0.8;
      b.meta.glowColor = "#ffffff";
      if (this.options.reducedMotion || b.isStatic) continue;
      this.wake(b);
      Body.setVelocity(b, { x: (Math.random() - 0.5) * 9, y: -5 - Math.random() * 5 });
      Body.setAngularVelocity(b, (Math.random() - 0.5) * 0.5);
    }
    this.rescalePile();
  }

  beginBuild(keepExisting: boolean) {
    if (!keepExisting) this.clearStack();
    else for (const b of this.stack.values()) if (b.meta) b.meta.stale = true;
    this.mode = "building";
    this.settledFired = false;
    this.edges = [];
    this.rescalePile();
  }

  /** Launch a technology block from the pile (or spawn it) into its architecture group. */
  select(spec: StackBlockSpec) {
    const existing = this.stack.get(spec.slotId);
    if (existing?.meta && existing.meta.tech.id === spec.tech.id) {
      existing.meta.stale = false;
      existing.meta.glow = 1;
      existing.meta.glowColor = GROUP_COLORS[spec.group];
      return;
    }
    if (existing) this.remove(spec.slotId);
    const shelf = this.ensureShelf(spec.group);
    shelf.slots.push(spec.slotId);
    this.layoutShelves();
    const size = this.stackSize();
    const targetX = this.slotX(shelf, spec.slotId);
    const cat = rowCategory(spec.group);
    const pileBody = this.pile.find((b) => b.meta?.tech.id === spec.tech.id && b.position.y > 0 && b.position.y < this.height);
    let body: MBody;
    if (this.options.reducedMotion) {
      if (pileBody) Body.setPosition(pileBody, { x: -500, y: -500 });
      body = this.makeBlock(spec.tech, "stack", size, targetX, shelf.y - size / 2 - 1);
      body.collisionFilter.category = cat;
      body.collisionFilter.mask = cat | CAT_WALL;
      Body.setAngle(body, 0);
      Body.setStatic(body, true);
    } else if (pileBody) {
      // Launch the very block from the crowd.
      this.pile = this.pile.filter((x) => x !== pileBody);
      body = pileBody;
      this.queueLaunch(body, spec, false);
      // Refill the pile with a replacement block so the universe never empties.
      const replacement = this.techs.find((t) => !this.pile.some((x) => x.meta?.tech.id === t.id) && ![...this.stack.values()].some((x) => x.meta?.tech.id === t.id) && t.id !== spec.tech.id);
      if (replacement) this.spawnQueue.push(replacement);
    } else {
      // Not currently visible in the pile: it emerges from inside the crowd, near where it will fly.
      const origin = this.emergencePoint(targetX);
      body = this.makeBlock(spec.tech, "stack", this.pileSize(), origin.x, origin.y);
      this.queueLaunch(body, spec, true);
    }
    body.meta!.kind = "stack";
    body.meta!.slotId = spec.slotId;
    body.meta!.group = spec.group;
    body.meta!.stale = false;
    body.meta!.born = performance.now();
    this.stack.set(spec.slotId, body);
    shelf.bodies.push(body);
    this.settledFired = false;
  }

  /** Where a block not visible in the pile emerges: a point inside the crowd, biased toward its slot. */
  private emergencePoint(targetX: number): { x: number; y: number } {
    const top = this.pileTop();
    const visible = this.pile.filter((b) => b.position.y > top && b.position.y < this.height);
    if (visible.length) {
      const near = visible.sort((a, b) => Math.abs(a.position.x - targetX) - Math.abs(b.position.x - targetX)).slice(0, 12);
      const pick = near[Math.floor(Math.random() * near.length)];
      return { x: pick.position.x, y: pick.position.y };
    }
    return { x: targetX + (Math.random() - 0.5) * 200, y: this.height - 30 };
  }

  /** Launches are spaced out slightly so every arc reads on its own. */
  private queueLaunch(body: MBody, spec: StackBlockSpec, fadeIn: boolean) {
    // Park the block where it is while it waits: it no longer collides and ignores gravity.
    body.collisionFilter.mask = 0;
    this.flights.set(body, this.parkedFlight(body, spec, fadeIn));
    this.launchQueue.push(() => this.launch(body, spec, fadeIn));
  }

  private parkedFlight(body: MBody, spec: StackBlockSpec, fadeIn: boolean): Flight {
    const size = body.meta?.size ?? this.pileSize();
    return { t0: Number.POSITIVE_INFINITY, duration: 1, from: { x: body.position.x, y: body.position.y }, v0: { x: 0, y: 0 }, g: 0, aim: { x: body.position.x, y: body.position.y }, slotId: spec.slotId, group: spec.group, sizeFrom: size, sizeTo: size, angleFrom: body.angle, spin: 0, fadeIn, trail: [] };
  }

  private launch(body: MBody, spec: StackBlockSpec, fadeIn: boolean) {
    if (!this.flights.has(body) || this.stack.get(spec.slotId) !== body) return; // removed while queued
    const shelf = this.shelves.get(spec.group);
    if (!shelf) return;
    const sizeTo = this.stackSize();
    const aim = { x: this.slotX(shelf, spec.slotId), y: shelf.y - sizeTo / 2 - 34 };
    const from = { x: body.position.x, y: body.position.y };
    const dx = aim.x - from.x;
    const dy = aim.y - from.y; // negative: the slot is above the pile
    const dist = Math.hypot(dx, dy);
    const duration = Math.min(1150, Math.max(680, 480 + dist * 0.6));
    // Gravity strong enough that the block is already falling when it reaches the slot.
    const g = Math.max(0.0026, (2.8 * Math.abs(Math.min(dy, 0))) / (duration * duration));
    const v0 = { x: dx / duration, y: (dy - 0.5 * g * duration * duration) / duration };
    // Spin one full turn and finish upright.
    const turns = Math.sign(dx || 1);
    const spin = -body.angle + turns * Math.PI * 2;
    // Pop: knock the neighbours aside so the block visibly bursts out of the crowd.
    for (const other of this.pile) {
      const ox = other.position.x - from.x;
      const oy = other.position.y - from.y;
      const d = Math.hypot(ox, oy);
      if (d > 0 && d < 90) {
        this.wake(other);
        const f = (0.0022 * other.mass * (90 - d)) / 90;
        Body.applyForce(other, other.position, { x: (ox / d) * f, y: (oy / d) * f - f * 0.6 });
      }
    }
    if (body.meta) {
      body.meta.glow = 1;
      body.meta.glowColor = GROUP_COLORS[spec.group];
    }
    this.wake(body);
    Body.setStatic(body, false);
    body.collisionFilter.mask = 0; // flies through the pile and the other rows
    this.flights.set(body, { t0: performance.now(), duration, from, v0, g, aim, slotId: spec.slotId, group: spec.group, sizeFrom: body.meta?.size ?? this.pileSize(), sizeTo, angleFrom: body.angle, spin, fadeIn, trail: [] });
  }

  /** Advance every flight to its exact position on the arc (runs after each physics step). */
  private stepFlights(now: number) {
    if (this.launchQueue.length && now - this.lastLaunch > 95) {
      this.lastLaunch = now;
      this.launchQueue.shift()!();
    }
    for (const [body, f] of this.flights) {
      if (!body.meta) continue;
      if (!Number.isFinite(f.t0)) {
        // Waiting in the queue: hold still.
        Body.setPosition(body, f.from);
        Body.setVelocity(body, { x: 0, y: 0 });
        continue;
      }
      const t = Math.min(now - f.t0, f.duration);
      const k = t / f.duration;
      // If the row re-flowed while the block was airborne, steer smoothly toward the new slot.
      const shelf = this.shelves.get(f.group);
      const live = shelf ? { x: this.slotX(shelf, f.slotId), y: shelf.y - f.sizeTo / 2 - 34 } : f.aim;
      const ease = k * k * (3 - 2 * k);
      const x = f.from.x + f.v0.x * t + (live.x - f.aim.x) * ease;
      const y = f.from.y + f.v0.y * t + 0.5 * f.g * t * t + (live.y - f.aim.y) * ease;
      const size = f.sizeFrom + (f.sizeTo - f.sizeFrom) * (1 - (1 - k) * (1 - k));
      if (Math.abs(size - body.meta.size) > 0.01) {
        const s = size / body.meta.size;
        Body.scale(body, s, s);
        body.meta.size = size;
      }
      const angle = f.angleFrom + f.spin * (1 - Math.pow(1 - k, 3));
      this.wake(body);
      Body.setAngle(body, angle);
      Body.setPosition(body, { x, y });
      Body.setVelocity(body, { x: 0, y: 0 });
      f.trail.push({ x, y, angle, size });
      if (f.trail.length > 9) f.trail.shift();
      if (t >= f.duration) this.land(body, f);
    }
  }

  /** Hand the block to the physics engine with the velocity it arrived with; it drops onto its shelf. */
  private land(body: MBody, f: Flight) {
    this.flights.delete(body);
    // Held still for the whole flight, the engine may have put it to sleep: wake it so the drop is real.
    this.wake(body);
    const cat = rowCategory(f.group);
    body.collisionFilter.category = cat;
    body.collisionFilter.mask = cat | CAT_WALL;
    Body.setAngle(body, Math.round(body.angle / (Math.PI / 2)) * (Math.PI / 2));
    const vy = Math.min(14, (f.v0.y + f.g * f.duration) * STEP_MS);
    Body.setVelocity(body, { x: 0, y: vy });
    Body.setAngularVelocity(body, 0);
    if (body.meta) body.meta.born = performance.now() - 700; // rows may organize immediately
  }

  /** Drop a block out of the stack back into the pile. */
  remove(slotId: string) {
    const body = this.stack.get(slotId);
    if (!body) return;
    this.stack.delete(slotId);
    this.flights.delete(body);
    for (const shelf of this.shelves.values()) {
      shelf.bodies = shelf.bodies.filter((b) => b !== body);
      shelf.slots = shelf.slots.filter((s) => s !== slotId);
    }
    this.layoutShelves();
    this.wake(body);
    const meta = body.meta!;
    meta.kind = "pile";
    meta.slotId = undefined;
    meta.glow = 0.9;
    meta.glowColor = "#ff6b6b";
    const size = this.pileSize();
    const scale = size / meta.size;
    Body.scale(body, scale, scale);
    meta.size = size;
    body.collisionFilter.category = CAT_PILE;
    body.collisionFilter.mask = CAT_PILE | CAT_WALL;
    if (this.options.reducedMotion) {
      Composite.remove(this.engine.world, body);
      return;
    }
    Body.setStatic(body, false);
    Body.setVelocity(body, { x: (Math.random() - 0.5) * 12, y: -6 });
    this.pile.push(body);
    this.pruneEmptyShelves();
  }

  /** Remove every stack block that was not re-confirmed during a rebuild. */
  finishBuild(edges: Array<{ from: string; to: string }>) {
    for (const [slotId, b] of [...this.stack]) if (b.meta?.stale) this.remove(slotId);
    this.edges = edges;
    this.settledFired = false;
    if (this.stack.size === 0) {
      // Nothing was built (e.g. the request failed): return to the full universe.
      this.mode = "idle";
      this.rescalePile();
      return;
    }
    this.mode = "complete";
  }

  clearStack() {
    for (const slotId of [...this.stack.keys()]) this.remove(slotId);
    for (const shelf of this.shelves.values()) this.removeShelfBodies(shelf);
    this.shelves.clear();
    this.labels = [];
    this.edges = [];
    this.mode = "idle";
    this.rescalePile();
  }

  getStackSlots(): string[] {
    return [...this.stack.keys()];
  }

  /** Screen position of a stack block (for tests and tooling). */
  getBlockPosition(slotId: string): { x: number; y: number } | undefined {
    const b = this.stack.get(slotId);
    return b ? { x: b.position.x, y: b.position.y } : undefined;
  }

  /** Highest on-screen pile block edge in CSS px (tests and tooling). */
  getVisiblePileTop(): number {
    const ys = this.pile.filter((b) => b.position.y > 0 && b.position.y < this.height).map((b) => b.position.y - (b.meta?.size ?? 0) / 2);
    return ys.length ? Math.min(...ys) : this.height;
  }

  getPileCount(): number {
    return this.pile.length;
  }

  /** Screen position of any pile block by technology id (for tests and tooling). */
  getPilePosition(techId: string): { x: number; y: number } | undefined {
    const b = this.pile.find((x) => x.meta?.tech.id === techId);
    return b ? { x: b.position.x, y: b.position.y } : undefined;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = Math.max(320, rect.width);
    this.height = Math.max(320, rect.height);
    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    for (const w of this.walls) Composite.remove(this.engine.world, w);
    const t = 200;
    this.walls = [
      Bodies.rectangle(this.width / 2, this.height + t / 2, this.width + t * 2, t, { isStatic: true, label: "floor" }),
      Bodies.rectangle(-t / 2, this.height / 2, t, this.height * 4, { isStatic: true, label: "wall" }),
      Bodies.rectangle(this.width + t / 2, this.height / 2, t, this.height * 4, { isStatic: true, label: "wall" }),
    ];
    for (const w of this.walls) {
      w.collisionFilter.category = CAT_WALL;
      w.collisionFilter.mask = 0xffff;
      w.friction = 0.8;
    }
    Composite.add(this.engine.world, this.walls);
    if (this.mouseConstraint) {
      this.mouseConstraint.mouse.pixelRatio = this.dpr;
    }
    for (const b of this.pile) this.wake(b);
    if (this.options.reducedMotion && this.pile.length) this.layoutStaticPile();
    if (this.shelves.size) this.layoutShelves(true);
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    Runner.stop(this.runner);
    Composite.clear(this.engine.world, false);
    Engine.clear(this.engine);
  }

  // ---------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------

  private pileSize() {
    const base = this.width < 700 ? 30 : this.width < 1100 ? 38 : 44;
    return this.mode === "idle" ? base : Math.round(base * 0.62);
  }

  /** Reduced motion: a still grid of at most three rows along the bottom edge. */
  private layoutStaticPile() {
    const size = this.pileSize();
    const gap = 6;
    const cols = Math.max(1, Math.floor((this.width - gap) / (size + gap)));
    const offset = (this.width - cols * (size + gap) + gap) / 2;
    const visible = cols * 3;
    this.pile.forEach((b, i) => {
      if (b.meta && Math.abs(b.meta.size - size) > 0.5) {
        const k = size / b.meta.size;
        Body.scale(b, k, k);
        b.meta.size = size;
      }
      const col = i % cols;
      const row = Math.floor(i / cols);
      const hidden = i >= visible;
      Body.setPosition(b, hidden ? { x: -500, y: -500 } : { x: offset + col * (size + gap) + size / 2, y: this.height - gap - row * (size + gap) - size / 2 });
    });
  }

  /** Rescale every pile block to the current mode's size (compact while a stack is shown). */
  private rescalePile() {
    if (this.options.reducedMotion) {
      this.layoutStaticPile();
      return;
    }
    const size = this.pileSize();
    for (const b of this.pile) {
      if (!b.meta || Math.abs(b.meta.size - size) < 0.5) continue;
      const k = size / b.meta.size;
      this.wake(b);
      Body.scale(b, k, k);
      b.meta.size = size;
      if (!b.isStatic) Body.setVelocity(b, { x: b.velocity.x, y: b.velocity.y + 1 });
    }
  }

  /** Top of the pile (15th percentile of block tops), used to keep the stack above it. */
  private pileTop(): number {
    const visible = this.pile.filter((b) => b.position.y > 0 && b.position.y < this.height + 50);
    if (!visible.length) return this.height;
    const ys = visible.map((b) => b.position.y - (b.meta?.size ?? 0) / 2).sort((a, b) => a - b);
    return ys[Math.floor(ys.length * 0.15)];
  }
  private lastPileTop = 0;
  private stackSize() {
    return this.width < 700 ? 44 : this.width < 1100 ? 54 : 64;
  }

  private ensureShelf(group: ArchitectureGroup): Shelf {
    let shelf = this.shelves.get(group);
    if (!shelf) {
      shelf = { group, y: 0, left: 0, right: 0, bodies: [], slots: [] };
      this.shelves.set(group, shelf);
    }
    return shelf;
  }

  private removeShelfBodies(shelf: Shelf) {
    for (const s of shelf.statics ?? []) Composite.remove(this.engine.world, s);
    shelf.statics = [];
  }

  private pruneEmptyShelves() {
    for (const [g, shelf] of [...this.shelves]) {
      if (shelf.slots.length === 0) {
        this.removeShelfBodies(shelf);
        this.shelves.delete(g);
      }
    }
    this.layoutShelves();
  }

  /** Position shelves as rows in the upper part of the canvas. */
  private layoutShelves(reposition = false) {
    const groups = GROUP_ORDER.filter((g) => this.shelves.has(g));
    const size = this.stackSize();
    const top = this.topInset + (this.width < 700 ? 24 : 8);
    const pileTop = this.pileTop();
    this.lastPileTop = pileTop;
    const bottom = Math.max(top + size * 1.5, Math.min(this.height * 0.86, pileTop - 36));
    const n = groups.length;
    const rowH = n ? Math.min(size + 44, (bottom - top) / n) : 0;
    this.labels = [];
    groups.forEach((g, i) => {
      const shelf = this.shelves.get(g)!;
      const y = top + rowH * (i + 1) - 6;
      const count = Math.max(1, shelf.slots.length);
      const gap = 14;
      const w = count * size + (count - 1) * gap + 40;
      const cx = this.width / 2;
      const left = cx - w / 2;
      const right = cx + w / 2;
      const moved = Math.abs(shelf.y - y) > 0.5 || Math.abs(shelf.left - left) > 0.5;
      shelf.y = y;
      shelf.left = left;
      shelf.right = right;
      this.labels.push(this.width < 700 ? { group: g, y: y - size - 12, x: cx } : { group: g, y: y - size / 2, x: left - 18 });
      if (moved) {
        this.removeShelfBodies(shelf);
        const lipH = size * 1.6;
        const statics = [
          Bodies.rectangle(cx, y + 6, w, 12, { isStatic: true, label: "shelf" }),
          Bodies.rectangle(left - 6, y - lipH / 2 + 6, 12, lipH, { isStatic: true, label: "lip" }),
          Bodies.rectangle(right + 6, y - lipH / 2 + 6, 12, lipH, { isStatic: true, label: "lip" }),
        ];
        for (const s of statics) {
          s.collisionFilter.category = rowCategory(g);
          s.collisionFilter.mask = rowCategory(g);
          s.friction = 0.9;
        }
        shelf.statics = statics;
        Composite.add(this.engine.world, statics);
        if (reposition || this.options.reducedMotion) {
          for (const b of shelf.bodies) {
            if (!b.meta?.slotId) continue;
            Body.setPosition(b, { x: this.slotX(shelf, b.meta.slotId), y: y - size / 2 - 1 });
            Body.setVelocity(b, { x: 0, y: 0 });
          }
        } else {
          // Nudge blocks so they re-settle on the moved shelf.
          for (const b of shelf.bodies) {
            this.wake(b);
            Body.setPosition(b, { x: b.position.x, y: Math.min(b.position.y, y - size) });
            Body.setVelocity(b, { x: 0, y: -1 });
          }
        }
      }
    });
  }

  private slotX(shelf: Shelf, slotId: string) {
    const size = this.stackSize();
    const gap = 14;
    const i = Math.max(0, shelf.slots.indexOf(slotId));
    return shelf.left + 20 + size / 2 + i * (size + gap);
  }

  // ---------------------------------------------------------------------
  // Bodies
  // ---------------------------------------------------------------------

  private makeBlock(tech: SceneTech, kind: "pile" | "stack", size: number, x: number, y: number): MBody {
    const body = Bodies.rectangle(x, y, size, size, {
      chamfer: { radius: size * 0.22 },
      restitution: 0.32,
      friction: 0.55,
      frictionAir: 0.015,
      density: 0.0022,
      angle: (Math.random() - 0.5) * 0.6,
    }) as MBody;
    body.collisionFilter.category = CAT_PILE;
    body.collisionFilter.mask = CAT_PILE | CAT_WALL;
    body.meta = { kind, tech, size, glow: 0, glowColor: "#fff", born: performance.now() };
    Composite.add(this.engine.world, body);
    return body;
  }

  private spawnPending(now: number) {
    if (!this.spawnQueue.length) return;
    const interval = this.pile.length < 40 ? 12 : 22;
    if (now - this.lastSpawn < interval) return;
    this.lastSpawn = now;
    const batch = Math.min(this.spawnQueue.length, 2);
    for (let i = 0; i < batch; i++) {
      const t = this.spawnQueue.shift()!;
      const size = this.pileSize();
      const x = 30 + Math.random() * (this.width - 60);
      const y = this.mode === "idle" ? -size - Math.random() * 200 : this.height * 0.55 - Math.random() * 60;
      const b = this.makeBlock(t, "pile", size, x, y);
      Body.setVelocity(b, { x: (Math.random() - 0.5) * 2, y: 4 + Math.random() * 4 });
      this.pile.push(b);
    }
  }

  // ---------------------------------------------------------------------
  // Pointer
  // ---------------------------------------------------------------------

  private bindPointer() {
    const mouse = Mouse.create(this.canvas);
    mouse.pixelRatio = this.dpr;
    this.mouseConstraint = MouseConstraint.create(this.engine, { mouse, constraint: { stiffness: 0.12, damping: 0.1, render: { visible: false } } });
    // Do not let the mouse constraint swallow wheel/touch scrolling.
    const m = mouse as unknown as { element: HTMLElement; mousewheel: EventListener };
    m.element.removeEventListener("wheel", m.mousewheel);
    Composite.add(this.engine.world, this.mouseConstraint);
    Events.on(this.mouseConstraint, "startdrag", () => {
      this.pointer.down = true;
      this.pointer.moved = false;
    });
    Events.on(this.mouseConstraint, "enddrag", () => {
      this.pointer.down = false;
    });
    this.canvas.addEventListener("pointermove", (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.pointer.x = e.clientX - rect.left;
      this.pointer.y = e.clientY - rect.top;
      if (this.pointer.down) this.pointer.moved = true;
    });
    this.canvas.addEventListener("pointerleave", () => {
      this.pointer.x = -1;
      this.pointer.y = -1;
    });
    this.canvas.addEventListener("click", () => {
      if (this.pointer.moved) return;
      const b = this.bodyAt(this.pointer.x, this.pointer.y);
      if (b?.meta) {
        if (b.meta.kind === "stack" && b.meta.slotId) this.callbacks.onClick?.({ kind: "stack", slotId: b.meta.slotId, tech: b.meta.tech });
        else this.callbacks.onClick?.({ kind: "pile", tech: b.meta.tech });
      }
    });
  }

  private bodyAt(x: number, y: number): MBody | null {
    if (x < 0) return null;
    const all = [...this.stack.values(), ...this.pile];
    const hits = Query.point(all, { x, y }) as MBody[];
    return hits.length ? hits[hits.length - 1] : null;
  }

  // ---------------------------------------------------------------------
  // Render loop
  // ---------------------------------------------------------------------

  private tick() {
    const now = performance.now();
    this.spawnPending(now);
    if (this.mode !== "idle" && this.shelves.size && now % 600 < 17 && Math.abs(this.pileTop() - this.lastPileTop) > 24) this.layoutShelves();
    // Sleep far-fallen or escaped bodies back into bounds.
    for (const b of this.pile) {
      if (b.position.y > this.height + 300 || b.position.x < -300 || b.position.x > this.width + 300) {
        this.wake(b);
        Body.setPosition(b, { x: 30 + Math.random() * (this.width - 60), y: -50 });
        Body.setVelocity(b, { x: 0, y: 0 });
      }
    }
    // Self-healing: a stack block that ended up off its shelf (pushed past a lip, or left behind by a relayout) is put back above its slot.
    if (!this.options.reducedMotion && now % 400 < 17) {
      const size = this.stackSize();
      for (const shelf of this.shelves.values()) {
        for (const b of shelf.bodies) {
          if (!b.meta?.slotId || this.mouseConstraint?.body === b || this.flights.has(b)) continue;
          const belowShelf = b.position.y > shelf.y + 4;
          const outside = b.position.x < shelf.left - 2 || b.position.x > shelf.right + 2;
          const tooHigh = b.position.y < shelf.y - size * 2.6;
          if (belowShelf || outside || tooHigh) {
            this.wake(b);
            Body.setPosition(b, { x: this.slotX(shelf, b.meta.slotId), y: shelf.y - size - 16 });
            Body.setVelocity(b, { x: 0, y: 0 });
            Body.setAngularVelocity(b, 0);
          }
        }
      }
    }
    // Rows self-organize: once a block has landed, it glides toward its slot (slots move when a row grows).
    if (!this.options.reducedMotion) {
      for (const shelf of this.shelves.values()) {
        for (const b of shelf.bodies) {
          if (!b.meta?.slotId || this.mouseConstraint?.body === b || b.isStatic || this.flights.has(b)) continue;
          if (performance.now() - b.meta.born < 700) continue; // let the fall play out first
          const dx = this.slotX(shelf, b.meta.slotId) - b.position.x;
          if (Math.abs(dx) > 1.5) {
            this.wake(b);
            Body.setVelocity(b, { x: Math.max(-9, Math.min(9, dx * 0.18)), y: b.velocity.y });
          }
          else if (Math.abs(b.velocity.x) > 0.05) Body.setVelocity(b, { x: 0, y: b.velocity.y });
        }
      }
    }
    // Stack blocks settle upright: ease the angle toward the nearest quarter turn once they slow down.
    if (!this.options.reducedMotion) {
      for (const b of this.stack.values()) {
        if (b.isStatic || b.isSleeping || b.speed > 1.2 || this.flights.has(b)) continue;
        const q = Math.PI / 2;
        const target = Math.round(b.angle / q) * q;
        const diff = target - b.angle;
        if (Math.abs(diff) < 0.01) {
          if (b.angle !== target) Body.setAngle(b, target);
          if (Math.abs(b.angularVelocity) > 0.001) Body.setAngularVelocity(b, 0);
        } else {
          Body.setAngularVelocity(b, diff * 0.12);
        }
      }
    }
    const hover = this.bodyAt(this.pointer.x, this.pointer.y);
    if (hover !== this.hover) {
      this.hover = hover;
      this.canvas.style.cursor = hover ? "pointer" : "default";
      if (!hover) this.callbacks.onHover?.(null);
      else if (hover.meta?.kind === "stack" && hover.meta.slotId) this.callbacks.onHover?.({ kind: "stack", slotId: hover.meta.slotId, tech: hover.meta.tech });
      else if (hover.meta) this.callbacks.onHover?.({ kind: "pile", tech: hover.meta.tech });
    }
    if (this.mode === "complete" && !this.settledFired) {
      const moving = this.flights.size > 0 || [...this.stack.values()].some((b) => b.speed > 0.35 || Math.abs(b.angularSpeed) > 0.05);
      if (!moving) {
        this.settledFired = true;
        this.callbacks.onSettled?.();
      }
    }
    this.draw(now);
  }

  private faviconFor(tech: SceneTech): HTMLImageElement | null {
    if (!tech.domain) return null;
    const cached = this.favicons.get(tech.id);
    if (cached !== undefined) return cached && cached.complete && cached.naturalWidth > 0 ? cached : null;
    const img = new Image();
    img.decoding = "async";
    img.onerror = () => this.favicons.set(tech.id, null);
    img.src = `/api/favicon?domain=${encodeURIComponent(tech.domain)}`;
    this.favicons.set(tech.id, img);
    return null;
  }

  private pathFor(tech: SceneTech): Path2D | undefined {
    if (!tech.iconPath) return undefined;
    let p = this.paths.get(tech.id);
    if (!p) {
      p = new Path2D(tech.iconPath);
      this.paths.set(tech.id, p);
    }
    return p;
  }

  private draw(now: number) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    const dimPile = this.mode !== "idle";

    // Group labels
    if (this.labels.length) {
      ctx.save();
      ctx.font = "600 10px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif";
      ctx.textAlign = this.width < 700 ? "center" : "right";
      ctx.textBaseline = "middle";
      for (const l of this.labels) {
        ctx.fillStyle = GROUP_COLORS[l.group] + "aa";
        ctx.letterSpacing = "0.22em";
        ctx.fillText(l.group, l.x, l.y);
      }
      ctx.restore();
    }
    // Shelves (hairlines)
    for (const shelf of this.shelves.values()) {
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(shelf.left, shelf.y + 0.5);
      ctx.lineTo(shelf.right, shelf.y + 0.5);
      ctx.stroke();
    }
    // Edges (after settle)
    if (this.mode === "complete" && this.settledFired && this.edges.length) {
      ctx.save();
      ctx.lineWidth = 1;
      for (const e of this.edges) {
        const a = this.stack.get(e.from);
        const b = this.stack.get(e.to);
        if (!a || !b || !a.meta || !b.meta) continue;
        const color = GROUP_COLORS[b.meta.group ?? "INFRASTRUCTURE"];
        ctx.strokeStyle = color + "55";
        ctx.beginPath();
        const midY = (a.position.y + b.position.y) / 2;
        ctx.moveTo(a.position.x, a.position.y);
        ctx.bezierCurveTo(a.position.x, midY, b.position.x, midY, b.position.x, b.position.y);
        ctx.stroke();
      }
      ctx.restore();
    }
    // Pile then stack so stack blocks sit on top visually
    for (const b of this.pile) this.drawBlock(b, now, dimPile ? 0.42 : 1);
    for (const b of this.stack.values()) if (!this.flights.has(b)) this.drawBlock(b, now, 1);
    for (const [b, f] of this.flights) this.drawFlight(b, f, now);
    // Hover tooltip
    if (this.hover?.meta) {
      const b = this.hover;
      const name = b.meta!.tech.name;
      ctx.save();
      ctx.font = "500 12px ui-sans-serif, system-ui, sans-serif";
      const w = ctx.measureText(name).width + 16;
      const h = 22;
      const size = b.meta!.size;
      const clampX = (v: number) => Math.min(Math.max(8, v), this.width - w - 8);
      // Rows sit close together, so a label pinned above the block can cover the one
      // on the row above. Try above, below, right, left and take the first free side.
      const spots = [
        { x: clampX(b.position.x - w / 2), y: b.position.y - size / 2 - 30 },
        { x: clampX(b.position.x - w / 2), y: b.position.y + size / 2 + 8 },
        { x: clampX(b.position.x + size / 2 + 8), y: b.position.y - h / 2 },
        { x: clampX(b.position.x - size / 2 - 8 - w), y: b.position.y - h / 2 },
      ];
      const others = [...this.stack.values(), ...this.pile].filter((o) => o !== b && o.meta);
      const free = spots.find((s) => {
        if (s.y < 8 || s.y + h > this.height - 8) return false;
        return !others.some((o) => {
          const half = o.meta!.size / 2;
          return s.x < o.position.x + half && s.x + w > o.position.x - half && s.y < o.position.y + half && s.y + h > o.position.y - half;
        });
      });
      const { x, y } = free ?? spots[0];
      ctx.fillStyle = "rgba(10,10,12,0.92)";
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      this.roundRect(x, y, w, h, 6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#f2f2f2";
      ctx.textBaseline = "middle";
      ctx.fillText(name, x + 8, y + h / 2);
      ctx.restore();
    }
  }

  private drawBlock(b: MBody, now: number, alpha: number) {
    const meta = b.meta;
    if (!meta) return;
    const ctx = this.ctx;
    const size = meta.size;
    const query = this.highlightQuery;
    const matchesQuery = query.length >= 2 && this.mode === "idle" && (meta.tech.name.toLowerCase().includes(query) || meta.tech.categories.some((c) => c.includes(query)));
    if (meta.glow > 0) meta.glow = Math.max(0, meta.glow - 0.012);
    const glow = matchesQuery ? 0.9 : meta.glow;
    const isHover = this.hover === b;
    const age = Math.min(1, (now - meta.born) / 260);
    ctx.save();
    ctx.translate(b.position.x, b.position.y);
    ctx.rotate(b.angle);
    const stackAlpha = meta.stale ? 0.38 : 1; // under review during a follow-up
    ctx.globalAlpha = (matchesQuery || isHover ? 1 : meta.kind === "stack" ? stackAlpha : alpha) * age;
    if (glow > 0.05 || isHover) {
      ctx.shadowColor = isHover ? "#ffffff" : meta.glowColor;
      ctx.shadowBlur = isHover ? 18 : 30 * glow;
    }
    // Pre-rendered sprite: one drawImage per block instead of re-rasterizing paths every frame.
    const pad = 1;
    ctx.drawImage(this.spriteFor(meta.tech, size), -size / 2 - pad, -size / 2 - pad, size + pad * 2, size + pad * 2);
    if (isHover) {
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = 1.5;
      this.roundRect(-size / 2, -size / 2, size, size, size * 0.22);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** A block in the air: a fading motion trail, then the block itself with its group glow. */
  private drawFlight(b: MBody, f: Flight, now: number) {
    if (!b.meta) return;
    const ctx = this.ctx;
    const sprite = this.spriteFor(b.meta.tech, Math.max(f.sizeTo, b.meta.size));
    const appear = f.fadeIn && Number.isFinite(f.t0) ? Math.min(1, (now - f.t0) / 180) : f.fadeIn ? 0 : 1;
    f.trail.forEach((p, i) => {
      const a = ((i + 1) / (f.trail.length + 1)) * 0.22 * appear;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.drawImage(sprite, -p.size / 2, -p.size / 2, p.size, p.size);
      ctx.restore();
    });
    ctx.save();
    ctx.translate(b.position.x, b.position.y);
    ctx.rotate(b.angle);
    ctx.globalAlpha = appear;
    ctx.shadowColor = GROUP_COLORS[f.group];
    ctx.shadowBlur = 26;
    const s = b.meta.size;
    ctx.drawImage(sprite, -s / 2 - 1, -s / 2 - 1, s + 2, s + 2);
    ctx.restore();
  }

  private spriteFor(tech: SceneTech, size: number): HTMLCanvasElement {
    const path = this.pathFor(tech);
    const favicon = path ? null : this.faviconFor(tech);
    const key = `${tech.id}:${Math.round(size)}:${this.dpr}:${favicon ? 1 : 0}`;
    let sprite = this.sprites.get(key);
    if (sprite) return sprite;
    const pad = 1;
    sprite = document.createElement("canvas");
    sprite.width = Math.ceil((size + pad * 2) * this.dpr);
    sprite.height = sprite.width;
    const c = sprite.getContext("2d")!;
    c.scale(this.dpr, this.dpr);
    c.translate(size / 2 + pad, size / 2 + pad);
    c.fillStyle = tech.color;
    this.roundRect(-size / 2, -size / 2, size, size, size * 0.22, c);
    c.fill();
    c.strokeStyle = "rgba(255,255,255,0.14)";
    c.lineWidth = 1;
    c.stroke();
    const ink = luminance(tech.color) > 0.62 ? "rgba(0,0,0,0.85)" : "#ffffff";
    if (favicon) {
      const s = size * 0.56;
      c.save();
      this.roundRect(-s / 2, -s / 2, s, s, s * 0.2, c);
      c.clip();
      c.drawImage(favicon, -s / 2, -s / 2, s, s);
      c.restore();
    } else if (path) {
      const k = (size * 0.58) / 24;
      c.translate(-size * 0.29, -size * 0.29);
      c.scale(k, k);
      c.fillStyle = ink;
      c.fill(path);
    } else {
      c.fillStyle = ink;
      c.font = `700 ${Math.round(size * 0.34)}px ui-sans-serif, system-ui, sans-serif`;
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(tech.monogram, 0, 1);
    }
    if (this.sprites.size > 2000) this.sprites.clear();
    this.sprites.set(key, sprite);
    return sprite;
  }

  /** Bodies moved from code must be woken first, or a sleeping body ignores the change. */
  private wake(b: Matter.Body) {
    if (b.isSleeping) Sleeping.set(b, false);
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number, ctx: CanvasRenderingContext2D = this.ctx) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}

function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 0.3;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export const GROUP_COLOR = GROUP_COLORS;
