import { useRef } from "react";

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

  const minioUrl = import.meta.env.VITE_MINIO_URL ?? "";

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
      <img
        src={`${minioUrl}/raw/${panoId}.jpg`}
        className="h-full w-auto max-w-none pointer-events-none"
        alt=""
        draggable={false}
      />
    </div>
  );
}
