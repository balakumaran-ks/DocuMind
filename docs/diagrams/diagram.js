/*
 * Shared runtime for DocuMind diagrams.
 *
 * - Sizes the canvas from <meta name="diagram-size" content="WxH">.
 * - Replaces [data-icon] elements with inline stroke icons.
 * - edge(from, to, options) queues a connector; connectors are routed after
 *   fonts load, from the rendered position of each card, so layout can change
 *   without re-computing coordinates by hand.
 *
 * Rendered to PNG by scripts/render-diagrams.mjs.
 */
(function () {
  const ICONS = {
    logo: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 15l2 2 4-4"/>',
    browser: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 9h20"/><path d="M6 6.5h.01M9 6.5h.01"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h6"/>',
    database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5"/><path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3"/>',
    sparkles: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
    hash: '<path d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
    message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    bookmark: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
    layers: '<path d="M12 2L2 7l10 5 10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>',
    server: '<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01"/>',
    branch: '<circle cx="6" cy="5" r="2.5"/><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="7" r="2.5"/><path d="M6 7.5v9"/><path d="M18 9.5a6 6 0 0 1-6 6H8"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
    cloud: '<path d="M17.5 19H7a5 5 0 1 1 1.1-9.88A6 6 0 0 1 19.5 11a4 4 0 0 1-2 8z"/>',
    zap: '<path d="M13 2L3 14h9l-1 8 10-12h-9z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    code: '<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>',
    cpu: '<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
    flask: '<path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3"/><path d="M7 15h10"/>',
    list: '<path d="M3 6l1.5 1.5L7 5M3 13l1.5 1.5L7 12M3 20l1.5 1.5L7 19M11 6h10M11 13h10M11 20h10"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
    pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    merge: '<circle cx="18" cy="18" r="2.5"/><circle cx="6" cy="6" r="2.5"/><path d="M6 8.5V21"/><path d="M6 9a9 9 0 0 0 9 9h.5"/>',
    book: '<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/>',
    gauge: '<path d="M12 14l4-4"/><path d="M3.3 19a10 10 0 1 1 17.4 0"/>',
    flag: '<path d="M4 22V4a1 1 0 0 1 1-1h13l-2 5 2 5H5"/>',
    activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3L21 2M16 7l3 3M18.5 4.5l2 2"/>',
    rocket: '<path d="M5 15c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.8-.9.7-2.3-.1-3.1-.9-.8-2.2-.8-2.9.1z"/><path d="M12 15l-3-3a22 22 0 0 1 2-4A12.9 12.9 0 0 1 22 2c0 2.7-.8 7.5-6 11a22.4 22.4 0 0 1-4 2z"/><path d="M9 12H4s.6-3 2-4c1.6-1.1 5 0 5 0M12 15v5s3-.6 4-2c1.1-1.6 0-5 0-5"/>',
    stream: '<path d="M4 6h10M4 12h16M4 18h7"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  };

  const svgIcon = (name) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ""}</svg>`;

  const meta = document.querySelector('meta[name="diagram-size"]');
  const [W, H] = (meta ? meta.content : "1600x1000").split("x").map(Number);
  // This script loads in <head>, before <body> exists; size the body in draw().
  document.documentElement.style.width = `${W}px`;
  document.documentElement.style.height = `${H}px`;

  const queued = [];
  window.edge = (from, to, options = {}) => queued.push({ from, to, options });
  window.icon = svgIcon;

  function el(sel) {
    const node = typeof sel === "string" ? document.querySelector(sel) : sel;
    if (!node) throw new Error(`diagram: no element for ${sel}`);
    return node;
  }

  function box(sel) {
    const r = el(sel).getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }

  const DIRS = { l: [-1, 0], r: [1, 0], t: [0, -1], b: [0, 1] };

  function anchor(b, side, t) {
    const [dx, dy] = DIRS[side];
    switch (side) {
      case "l":
        return { x: b.x, y: b.y + b.h * t, dx, dy };
      case "r":
        return { x: b.x + b.w, y: b.y + b.h * t, dx, dy };
      case "t":
        return { x: b.x + b.w * t, y: b.y, dx, dy };
      default:
        return { x: b.x + b.w * t, y: b.y + b.h, dx, dy };
    }
  }

  function route(p0, p1, o) {
    if (o.points) return [p0, ...o.points.map(([x, y]) => ({ x, y })), p1];
    if (o.type === "straight") return [p0, p1];
    const h0 = p0.dx !== 0;
    const h1 = p1.dx !== 0;
    const via = o.via ?? 0.5;
    if (h0 && h1) {
      if (Math.abs(p0.y - p1.y) < 0.5) return [p0, p1];
      const mx = o.x ?? p0.x + (p1.x - p0.x) * via;
      return [p0, { x: mx, y: p0.y }, { x: mx, y: p1.y }, p1];
    }
    if (!h0 && !h1) {
      if (Math.abs(p0.x - p1.x) < 0.5) return [p0, p1];
      const my = o.y ?? p0.y + (p1.y - p0.y) * via;
      return [p0, { x: p0.x, y: my }, { x: p1.x, y: my }, p1];
    }
    if (h0) return [p0, { x: p1.x, y: p0.y }, p1];
    return [p0, { x: p0.x, y: p1.y }, p1];
  }

  function roundedPath(pts, radius) {
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1];
      const p = pts[i];
      const b = pts[i + 1];
      const lin = Math.hypot(p.x - a.x, p.y - a.y);
      const lout = Math.hypot(b.x - p.x, b.y - p.y);
      const r = Math.min(radius, lin / 2, lout / 2);
      const ix = (p.x - a.x) / lin;
      const iy = (p.y - a.y) / lin;
      const ox = (b.x - p.x) / lout;
      const oy = (b.y - p.y) / lout;
      d += ` L ${p.x - ix * r} ${p.y - iy * r} Q ${p.x} ${p.y} ${p.x + ox * r} ${p.y + oy * r}`;
    }
    const last = pts[pts.length - 1];
    return `${d} L ${last.x} ${last.y}`;
  }

  const NS = "http://www.w3.org/2000/svg";

  function draw() {
    document.body.style.width = `${W}px`;
    document.body.style.height = `${H}px`;
    document.querySelectorAll("[data-icon]").forEach((node) => {
      node.innerHTML = svgIcon(node.dataset.icon);
    });

    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "edges");
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);
    const defs = document.createElementNS(NS, "defs");
    svg.appendChild(defs);
    document.body.appendChild(svg);

    const markers = new Map();
    const marker = (color) => {
      if (markers.has(color)) return markers.get(color);
      const id = `arrow-${markers.size}`;
      const m = document.createElementNS(NS, "marker");
      m.setAttribute("id", id);
      m.setAttribute("viewBox", "0 0 12 12");
      m.setAttribute("refX", "10");
      m.setAttribute("refY", "6");
      m.setAttribute("markerWidth", "12");
      m.setAttribute("markerHeight", "12");
      m.setAttribute("markerUnits", "userSpaceOnUse");
      m.setAttribute("orient", "auto-start-reverse");
      const path = document.createElementNS(NS, "path");
      path.setAttribute("d", "M1.5 1.5 L10.5 6 L1.5 10.5 L4 6 Z");
      path.setAttribute("fill", color);
      path.setAttribute("stroke", color);
      path.setAttribute("stroke-linejoin", "round");
      m.appendChild(path);
      defs.appendChild(m);
      markers.set(color, id);
      return id;
    };

    for (const { from, to, options: o } of queued) {
      const color = o.color || "#94a3b8";
      const fromSide = o.from || "r";
      const toSide = o.to || "l";
      const p0 = anchor(box(from), fromSide, o.fromAt ?? 0.5);
      const p1 = anchor(box(to), toSide, o.toAt ?? 0.5);
      const g0 = o.startGap ?? (o.both ? 4 : 2);
      const g1 = o.noArrow ? 2 : o.endGap ?? 4;
      p0.x += p0.dx * g0;
      p0.y += p0.dy * g0;
      p1.x += p1.dx * g1;
      p1.y += p1.dy * g1;

      const d = roundedPath(route(p0, p1, o), o.radius ?? 12);

      const casing = document.createElementNS(NS, "path");
      casing.setAttribute("d", d);
      casing.setAttribute("fill", "none");
      casing.setAttribute("stroke", "rgba(255,255,255,0.9)");
      casing.setAttribute("stroke-width", (o.width || 2) + 5);
      casing.setAttribute("stroke-linecap", "round");
      svg.appendChild(casing);

      const path = document.createElementNS(NS, "path");
      path.setAttribute("d", d);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", color);
      path.setAttribute("stroke-width", o.width || 2);
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      if (o.dash) path.setAttribute("stroke-dasharray", o.dash === true ? "7 6" : o.dash);
      if (!o.noArrow) path.setAttribute("marker-end", `url(#${marker(color)})`);
      if (o.both) path.setAttribute("marker-start", `url(#${marker(color)})`);
      svg.appendChild(path);

      if (o.label || o.step != null) {
        const len = path.getTotalLength();
        const pt = o.labelPos
          ? { x: o.labelPos[0], y: o.labelPos[1] }
          : path.getPointAtLength(len * (o.labelAt ?? 0.5));
        const label = document.createElement("div");
        label.className = "edge-label" + (o.label ? "" : " step-only");
        label.style.setProperty("--c", color);
        label.style.left = `${pt.x + (o.labelDx || 0)}px`;
        label.style.top = `${pt.y + (o.labelDy || 0)}px`;
        label.innerHTML =
          (o.step != null ? `<span class="step">${o.step}</span>` : "") + (o.label ? `<span>${o.label}</span>` : "");
        document.body.appendChild(label);
      }
    }
    document.body.dataset.ready = "true";
  }

  const start = () => (document.fonts ? document.fonts.ready.then(draw) : draw());
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
