import { useEffect, useRef } from "react";
import * as THREE from "three";

interface Props {
  panoId: string;
}

export function PanoramaViewer({ panoId }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const frameRef = useRef<number>(0);
  const targetRef = useRef(new THREE.Vector3());

  // Drag state
  const drag = useRef({ active: false, x: 0, y: 0 });
  const look = useRef({ lon: 0, lat: 0 }); // degrees

  const s3Url = import.meta.env.VITE_S3_URL ?? "";

  // Init Three.js once
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      90,
      el.clientWidth / el.clientHeight,
      0.1,
      1100,
    );
    cameraRef.current = camera;

    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      const lat = Math.max(-85, Math.min(85, look.current.lat));
      const phi = THREE.MathUtils.degToRad(90 - lat);
      const theta = THREE.MathUtils.degToRad(look.current.lon);
      targetRef.current.set(
        500 * Math.sin(phi) * Math.cos(theta),
        500 * Math.cos(phi),
        500 * Math.sin(phi) * Math.sin(theta),
      );
      camera.lookAt(targetRef.current);
      renderer.render(scene, camera);
    };
    animate();

    const ro = new ResizeObserver(() => {
      if (!el) return;
      renderer.setSize(el.clientWidth, el.clientHeight);
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
    });
    ro.observe(el);

    return () => {
      cancelAnimationFrame(frameRef.current);
      ro.disconnect();
      renderer.dispose();
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Swap texture when panoId changes
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const old = scene.getObjectByName("sphere") as THREE.Mesh | undefined;
    if (old) {
      old.geometry.dispose();
      (old.material as THREE.MeshBasicMaterial).map?.dispose();
      (old.material as THREE.MeshBasicMaterial).dispose();
      scene.remove(old);
    }

    look.current = { lon: 0, lat: 0 };

    new THREE.TextureLoader().load(
      `${s3Url}/gssr-panoramas/raw/${panoId}.jpg`,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        const geo = new THREE.SphereGeometry(500, 60, 40);
        const mat = new THREE.MeshBasicMaterial({
          map: texture,
          side: THREE.BackSide,
        });
        const sphere = new THREE.Mesh(geo, mat);
        sphere.name = "sphere";
        scene.add(sphere);
      },
    );
  }, [panoId, s3Url]);

  const onMouseDown = (e: React.MouseEvent) => {
    drag.current = { active: true, x: e.clientX, y: e.clientY };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!drag.current.active) return;
    look.current.lon -= (e.clientX - drag.current.x) * 0.15;
    look.current.lat += (e.clientY - drag.current.y) * 0.15;
    drag.current.x = e.clientX;
    drag.current.y = e.clientY;
  };
  const onMouseUp = () => {
    drag.current.active = false;
  };

  const lastTouch = useRef({ x: 0, y: 0 });
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    lastTouch.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const t = e.touches[0];
    look.current.lon -= (t.clientX - lastTouch.current.x) * 0.15;
    look.current.lat += (t.clientY - lastTouch.current.y) * 0.15;
    lastTouch.current = { x: t.clientX, y: t.clientY };
  };

  const onWheel = (e: React.WheelEvent) => {
    const cam = cameraRef.current;
    if (!cam) return;
    cam.fov = Math.max(30, Math.min(100, cam.fov + e.deltaY * 0.05));
    cam.updateProjectionMatrix();
  };

  return (
    <div
      ref={mountRef}
      className="w-full h-full bg-black cursor-grab active:cursor-grabbing select-none"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onWheel={onWheel}
    />
  );
}
