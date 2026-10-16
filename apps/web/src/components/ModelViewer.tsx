import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import type { T } from "../i18n";

export default function ModelViewer({ url, t }: { url: string; t: T }) {
  const host = useRef<HTMLDivElement>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const container = host.current!;
    const controller = new AbortController();
    let renderer: THREE.WebGLRenderer | undefined,
      geometry: THREE.BufferGeometry | undefined;
    let controls: OrbitControls | undefined,
      material: THREE.MeshStandardMaterial | undefined;
    let frame = 0,
      cancelled = false;
    setError("");
    const observer = new ResizeObserver(() => {
      if (!renderer) return;
      const width = container.clientWidth,
        height = container.clientHeight;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    });
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#eceee4");
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100000);
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.setSize(container.clientWidth, container.clientHeight);
      container.appendChild(renderer.domElement);
      const light = new THREE.DirectionalLight(0xffffff, 3);
      light.position.set(1, 2, 3);
      scene.add(light, new THREE.HemisphereLight(0xffffff, 0x667755, 2));
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      observer.observe(container);
      void fetch(url, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error("Mesh could not be loaded");
          return response.arrayBuffer();
        })
        .then((buffer) => {
          if (cancelled) return;
          geometry = new STLLoader().parse(buffer);
          geometry.computeVertexNormals();
          geometry.computeBoundingBox();
          const box = geometry.boundingBox!,
            size = box.getSize(new THREE.Vector3()),
            center = box.getCenter(new THREE.Vector3());
          geometry.translate(-center.x, -center.y, -center.z);
          material = new THREE.MeshStandardMaterial({
            color: 0xa8bf72,
            roughness: 0.65,
            metalness: 0.05,
            side: THREE.DoubleSide,
          });
          scene.add(new THREE.Mesh(geometry, material));
          const extent = Math.max(size.x, size.y, size.z, 1);
          camera.position.set(extent * 1.8, -extent * 1.8, extent * 1.4);
          camera.up.set(0, 0, 1);
          camera.aspect = container.clientWidth / container.clientHeight;
          camera.updateProjectionMatrix();
          controls!.target.set(0, 0, 0);
          controls!.update();
          const animate = () => {
            if (cancelled) return;
            controls!.update();
            renderer!.render(scene, camera);
            frame = requestAnimationFrame(animate);
          };
          animate();
        })
        .catch((err) => {
          if (!cancelled) setError((err as Error).message);
        });
    } catch {
      setError(
        t(
          "无法启动 WebGL；仍可下载 STL 文件。",
          "WebGL is unavailable. The STL can still be downloaded.",
        ),
      );
    }
    return () => {
      cancelled = true;
      controller.abort();
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls?.dispose();
      geometry?.dispose();
      material?.dispose();
      renderer?.dispose();
      renderer?.domElement.remove();
    };
  }, [url]);
  return (
    <div
      className="model-viewer"
      ref={host}
      aria-label={t(
        "三维模型预览，可拖动旋转和缩放",
        "3D preview; drag to rotate and zoom",
      )}
    >
      {error && <p role="alert">{error}</p>}
      <span className="viewer-help">
        {t(
          "拖动旋转 · 滚轮缩放 · 单位 mm",
          "Drag to rotate · Scroll to zoom · mm",
        )}
      </span>
    </div>
  );
}
