import { useEffect, useRef } from "react";
import * as pannellum from "pannellum";
import "pannellum/build/pannellum.css";

// Pannellum UMD is bundled as a plain IIFE by esbuild → sets window.pannellum, exports nothing.
// Rollup prod: viewer is a named export on the namespace → use namespace directly.
// esbuild dev: viewer is on .default or window.pannellum.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pnl = (
  (pannellum as any).viewer
    ? pannellum
    : ((pannellum as any).default ?? (window as any).pannellum)
) as typeof pannellum;

// Pannellum multires tile parameters — must match tiling.py
const TILE_RESOLUTION = 512;
const MAX_LEVEL = 4;
const CUBE_FACE_RESOLUTION = 4096;

interface Props {
  panoId: string;
}

export function PanoramaViewer({ panoId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<ReturnType<typeof pannellum.viewer> | null>(null);
  const s3Url = import.meta.env.VITE_S3_URL ?? "";

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let cancelled = false;

    viewerRef.current?.destroy();
    viewerRef.current = null;

    const tileBase = `${s3Url}/gssr-panoramas/maps/panoramas/${panoId}`;
    const checkUrl = `${tileBase}/1/f0_0.jpg`;

    // Probe for tiles + fetch Pannellum config in parallel
    Promise.all([
      fetch(checkUrl, { method: "HEAD" })
        .then((r) => r.ok)
        .catch(() => false),
      fetch(`${tileBase}/config.json`)
        .then((r) => r.json())
        .catch(() => null),
    ]).then(([hasTiles, cfg]) => {
      if (cancelled || !containerRef.current) return;

      if (hasTiles && cfg) {
        // Use generate.py config.json: contains haov/vaov/vOffset/minYaw/maxPitch for partial panos
        cfg.multiRes.basePath = tileBase;
        cfg.autoLoad = true;
        cfg.showControls = false;
        cfg.compass = false;
        viewerRef.current = pnl.viewer(containerRef.current, cfg);
      } else if (hasTiles) {
        // Legacy: tiles exist but no config.json
        viewerRef.current = pnl.viewer(containerRef.current, {
          type: "multires",
          multiRes: {
            basePath: tileBase,
            path: `/%l/%s%y_%x`,
            extension: "jpg",
            tileResolution: TILE_RESOLUTION,
            maxLevel: MAX_LEVEL,
            cubeResolution: CUBE_FACE_RESOLUTION,
          },
          autoLoad: true,
          showControls: false,
          compass: false,
        });
      } else {
        // No tiles yet — equirectangular preview fallback
        viewerRef.current = pnl.viewer(containerRef.current, {
          type: "equirectangular",
          panorama: `${tileBase}/preview.jpg`,
          autoLoad: true,
          showControls: false,
          compass: false,
          hfov: 100,
          minHfov: 30,
          maxHfov: 120,
        });
      }
    });

    return () => {
      cancelled = true;
      viewerRef.current?.destroy();
      viewerRef.current = null;
    };
  }, [panoId, s3Url]);

  return <div ref={containerRef} className="w-full h-full" />;
}
