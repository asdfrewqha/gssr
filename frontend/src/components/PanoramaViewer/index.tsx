import { useEffect, useRef } from "react";
import * as pannellum from "pannellum";
import "pannellum/build/pannellum.css";

// Vite dev (esbuild) puts the UMD module on .default; Rollup prod synthesizes named exports.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pnl = (
  (pannellum as any).viewer ? pannellum : (pannellum as any).default
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
    const checkUrl = `${tileBase}/1/f/0_0.webp`;

    // Probe for tiles: if the level-1 front tile exists → use multires, else raw equirectangular
    fetch(checkUrl, { method: "HEAD" })
      .then((r) => r.ok)
      .catch(() => false)
      .then((hasTiles) => {
        if (cancelled || !containerRef.current) return;
        console.log(
          "[PanoramaViewer] hasTiles=%s size=%dx%d pnl.viewer=%s",
          hasTiles,
          containerRef.current.clientWidth,
          containerRef.current.clientHeight,
          typeof pnl.viewer,
        );

        if (hasTiles) {
          viewerRef.current = pnl.viewer(containerRef.current, {
            type: "multires",
            multiRes: {
              basePath: `${tileBase}`,
              path: `/%l/%s/%y_%x`,
              extension: "webp",
              tileResolution: TILE_RESOLUTION,
              maxLevel: MAX_LEVEL,
              cubeResolution: CUBE_FACE_RESOLUTION,
            },
            autoLoad: true,
            showControls: false,
            compass: false,
          });
        } else {
          viewerRef.current = pnl.viewer(containerRef.current, {
            type: "equirectangular",
            panorama: `${s3Url}/gssr-panoramas/raw/${panoId}.jpg`,
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
