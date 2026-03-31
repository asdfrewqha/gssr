import { useEffect, useRef } from "react";

interface Props {
  panoId: string;
}

interface DragState {
  active: boolean;
  startX: number;
  startY: number;
  scrollLeft: number;
  scrollTop: number;
}

export function PanoramaViewer({ panoId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState>({
    active: false,
    startX: 0,
    startY: 0,
    scrollLeft: 0,
    scrollTop: 0,
  });

  // Center the view on the horizon when the pano changes.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Small delay so the image has sized up before we read scrollHeight.
    const timer = setTimeout(() => {
      el.scrollTop = (el.scrollHeight - el.clientHeight) / 2;
      el.scrollLeft = 0;
    }, 50);
    return () => clearTimeout(timer);
  }, [panoId]);

  const onMouseDown = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    drag.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: containerRef.current.scrollLeft,
      scrollTop: containerRef.current.scrollTop,
    };
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!drag.current.active || !containerRef.current) return;
    containerRef.current.scrollLeft =
      drag.current.scrollLeft - (e.clientX - drag.current.startX);
    containerRef.current.scrollTop =
      drag.current.scrollTop - (e.clientY - drag.current.startY);
  };

  const onEnd = () => {
    drag.current.active = false;
  };

  // Touch support
  const lastTouch = useRef({ x: 0, y: 0 });
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    lastTouch.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (!containerRef.current) return;
    const t = e.touches[0];
    containerRef.current.scrollLeft -= t.clientX - lastTouch.current.x;
    containerRef.current.scrollTop -= t.clientY - lastTouch.current.y;
    lastTouch.current = { x: t.clientX, y: t.clientY };
  };

  const s3Url = import.meta.env.VITE_S3_URL ?? "";

  return (
    <div
      ref={containerRef}
      className="w-full h-full overflow-hidden bg-black cursor-grab active:cursor-grabbing select-none"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onEnd}
      onMouseLeave={onEnd}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
    >
      {/* Display at 200vh height so the equirectangular image overflows vertically.
          For a 2:1 panorama this gives ~400vh width — full horizontal rotation.
          Initial scrollTop is centered (horizon) via the useEffect above. */}
      <img
        src={`${s3Url}/gssr-panoramas/raw/${panoId}.jpg`}
        style={{ height: "200vh", width: "auto", maxWidth: "none" }}
        className="pointer-events-none"
        alt=""
        draggable={false}
      />
    </div>
  );
}
