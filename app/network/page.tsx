"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  relationshipLabel,
  type GraphData,
  type GraphNode,
} from "@/lib/relationships";

const WIDTH = 900;
const HEIGHT = 620;

const NODE_COLORS = [
  "#6366f1", "#10b981", "#f59e0b", "#ef4444",
  "#0ea5e9", "#8b5cf6", "#ec4899", "#14b8a6",
];
function colorFor(name: string): string {
  return NODE_COLORS[(name.charCodeAt(0) || 0) % NODE_COLORS.length];
}

type Pos = Record<string, { x: number; y: number }>;

// Deterministic force-directed layout (no randomness — seeded on a circle so it
// renders identically each run). Repulsion between all nodes, spring attraction
// along edges, mild gravity toward center.
function computeLayout(data: GraphData): Pos {
  const { nodes, edges } = data;
  const n = nodes.length;
  if (n === 0) return {};

  const pos: Pos = {};
  const vel: Record<string, { x: number; y: number }> = {};
  nodes.forEach((node, i) => {
    const a = (i / n) * 2 * Math.PI;
    pos[node.id] = { x: WIDTH / 2 + Math.cos(a) * 220, y: HEIGHT / 2 + Math.sin(a) * 220 };
    vel[node.id] = { x: 0, y: 0 };
  });

  const REPULSION = 9000;
  const SPRING = 0.02;
  const REST = 110;
  const GRAVITY = 0.012;
  const DAMP = 0.85;
  const iterations = 500;

  for (let iter = 0; iter < iterations; iter++) {
    // Repulsion between every pair.
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = pos[nodes[i].id];
        const b = pos[nodes[j].id];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const force = REPULSION / (dist * dist);
        dx /= dist;
        dy /= dist;
        vel[nodes[i].id].x += dx * force;
        vel[nodes[i].id].y += dy * force;
        vel[nodes[j].id].x -= dx * force;
        vel[nodes[j].id].y -= dy * force;
      }
    }
    // Spring attraction along edges.
    for (const e of edges) {
      const a = pos[e.fromId];
      const b = pos[e.toId];
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const force = SPRING * (dist - REST);
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      vel[e.fromId].x += fx;
      vel[e.fromId].y += fy;
      vel[e.toId].x -= fx;
      vel[e.toId].y -= fy;
    }
    // Gravity + integrate.
    for (const node of nodes) {
      vel[node.id].x += (WIDTH / 2 - pos[node.id].x) * GRAVITY;
      vel[node.id].y += (HEIGHT / 2 - pos[node.id].y) * GRAVITY;
      vel[node.id].x *= DAMP;
      vel[node.id].y *= DAMP;
      pos[node.id].x += vel[node.id].x;
      pos[node.id].y += vel[node.id].y;
    }
  }

  // Clamp into the viewBox with a margin.
  const M = 40;
  for (const node of nodes) {
    pos[node.id].x = Math.max(M, Math.min(WIDTH - M, pos[node.id].x));
    pos[node.id].y = Math.max(M, Math.min(HEIGHT - M, pos[node.id].y));
  }
  return pos;
}

export default function NetworkPage() {
  const router = useRouter();
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState(false);
  const [pos, setPos] = useState<Pos>({});
  const [hover, setHover] = useState<GraphNode | null>(null);
  const dragId = useRef<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    fetch("/api/relationships?graph=1", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((d: GraphData) => {
        setData(d);
        setPos(computeLayout(d));
      })
      .catch(() => setError(true));
  }, []);

  const nodeRadius = useCallback((node: GraphNode) => 9 + Math.min(14, node.degree * 2.5), []);

  // Convert a pointer event to SVG coordinates (accounts for viewBox scaling).
  const toSvg = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * WIDTH,
      y: ((clientY - rect.top) / rect.height) * HEIGHT,
    };
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragId.current) return;
      const { x, y } = toSvg(e.clientX, e.clientY);
      setPos((p) => ({ ...p, [dragId.current!]: { x, y } }));
    },
    [toSvg]
  );

  const nodeById = useMemo(() => {
    const m = new Map<string, GraphNode>();
    data?.nodes.forEach((n) => m.set(n.id, n));
    return m;
  }, [data]);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Network Map</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Who knows whom across your network. Drag to rearrange, click a node to open the contact.
          </p>
        </div>
        <Link
          href="/network-intel"
          className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800"
        >
          Network intelligence →
        </Link>
      </div>

      {error ? (
        <p className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-8 text-center text-sm text-zinc-500">
          Couldn&apos;t load the network.
        </p>
      ) : !data ? (
        <p className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-8 text-center text-sm text-zinc-400">
          Loading network…
        </p>
      ) : data.nodes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-10 text-center">
          <p className="text-3xl">🕸️</p>
          <p className="mt-2 font-medium">No connections yet</p>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Open a contact and use <span className="font-medium">Connections → Link contact</span> to
            map who knows whom. They&apos;ll appear here.
          </p>
          <Link
            href="/contacts"
            className="mt-4 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Go to contacts
          </Link>
        </div>
      ) : (
        <div className="relative overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="w-full touch-none select-none"
            style={{ height: "min(70vh, 620px)" }}
            onPointerMove={onPointerMove}
            onPointerUp={() => (dragId.current = null)}
            onPointerLeave={() => (dragId.current = null)}
          >
            {/* Edges */}
            {data.edges.map((e) => {
              const a = pos[e.fromId];
              const b = pos[e.toId];
              if (!a || !b) return null;
              return (
                <line
                  key={e.id}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="currentColor"
                  className="text-zinc-300 dark:text-zinc-700"
                  strokeWidth={0.6 + e.strength * 0.5}
                />
              );
            })}
            {/* Nodes */}
            {data.nodes.map((node) => {
              const p = pos[node.id];
              if (!p) return null;
              const r = nodeRadius(node);
              return (
                <g
                  key={node.id}
                  transform={`translate(${p.x},${p.y})`}
                  className="cursor-pointer"
                  onPointerDown={(e) => {
                    dragId.current = node.id;
                    (e.target as Element).setPointerCapture?.(e.pointerId);
                  }}
                  onClick={() => {
                    // Treat a click without a drag-move as navigation.
                    router.push(`/contacts/${node.id}`);
                  }}
                  onMouseEnter={() => setHover(node)}
                  onMouseLeave={() => setHover((h) => (h?.id === node.id ? null : h))}
                >
                  <circle r={r} fill={colorFor(node.name)} opacity={0.9} />
                  <text
                    y={r + 12}
                    textAnchor="middle"
                    className="fill-zinc-700 dark:fill-zinc-200"
                    style={{ fontSize: 11, fontWeight: 500 }}
                  >
                    {node.name.length > 18 ? `${node.name.slice(0, 17)}…` : node.name}
                  </text>
                </g>
              );
            })}
          </svg>

          {hover && (
            <div className="pointer-events-none absolute left-3 top-3 rounded-lg bg-zinc-900/90 px-3 py-2 text-xs text-white shadow-lg">
              <p className="font-semibold">{hover.name}</p>
              {(hover.title || hover.company) && (
                <p className="text-zinc-300">
                  {[hover.title, hover.company].filter(Boolean).join(" · ")}
                </p>
              )}
              <p className="text-zinc-400">
                {hover.degree} connection{hover.degree === 1 ? "" : "s"}
              </p>
            </div>
          )}

          <div className="border-t border-zinc-100 dark:border-zinc-800 px-4 py-2 text-xs text-zinc-500 dark:text-zinc-400">
            {data.nodes.length} people · {data.edges.length} connection
            {data.edges.length === 1 ? "" : "s"}
            {nodeById.size > 0 ? " · drag nodes to rearrange" : ""}
          </div>
        </div>
      )}
    </div>
  );
}
