import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ModelFrame, ModelPose, ModelWorkspace } from "@harness/core";
import type { T } from "../i18n";

function pose(object: THREE.Object3D, value: ModelPose) {
  object.position.fromArray(value.translation_m);
  object.quaternion.fromArray(value.rotation_xyzw);
}

export default function EngineSceneViewer({ workspace, frame, collision, selected, onSelect, t }: {
  workspace: ModelWorkspace; frame?: ModelFrame; collision: boolean; selected: string;
  onSelect: (id: string) => void; t: T;
}) {
  const host = useRef<HTMLDivElement>(null), [error, setError] = useState(false);
  const live = useRef({ frame, collision, selected, onSelect });
  live.current = { frame, collision, selected, onSelect };
  useEffect(() => {
    const element = host.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); } catch { setError(true); return; }
    setError(false);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    element.appendChild(renderer.domElement);
    renderer.domElement.setAttribute("aria-label", "Product envelope model; drag to orbit and click to inspect");
    const scene = new THREE.Scene(); scene.background = new THREE.Color("#edf0e7");
    scene.add(new THREE.HemisphereLight(0xffffff, 0x59604c, 2.4));
    const light = new THREE.DirectionalLight(0xffffff, 3); light.position.set(2, -3, 4); scene.add(light);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.00001, 10000); camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
    const bodies = new Map<string, THREE.Group>(), meshes: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[] = [];
    for (const body of workspace.scene.bodies) {
      const group = new THREE.Group(); bodies.set(body.entity_ref, group); scene.add(group);
      if (body.world_pose) pose(group, body.world_pose);
      else group.visible = false; // Missing placement must not fabricate geometry at the origin.
    }
    for (const envelope of workspace.scene.envelopes) {
      const shape = envelope.shape;
      let geometry: THREE.BufferGeometry;
      if (shape.kind === "box") geometry = new THREE.BoxGeometry(...shape.size_m);
      else if (shape.kind === "sphere") geometry = new THREE.SphereGeometry(shape.radius_m, 24, 16);
      else if (shape.kind === "cylinder") {
        geometry = new THREE.CylinderGeometry(shape.radius_m, shape.radius_m, shape.length_m, 24); geometry.rotateX(Math.PI / 2);
      } else if (shape.kind === "capsule") {
        geometry = new THREE.CapsuleGeometry(shape.radius_m, shape.segment_length_m, 8, 16); geometry.rotateX(Math.PI / 2);
      } else continue; // Asset files are not fetched implicitly by the viewer.
      const material = new THREE.MeshStandardMaterial({ color: 0xa8bf72, roughness: 0.65, metalness: 0.08 });
      const mesh = new THREE.Mesh(geometry, material); pose(mesh, envelope.pose);
      mesh.userData = { entity: envelope.entity_ref, purpose: envelope.purpose };
      bodies.get(envelope.body_ref)?.add(mesh); meshes.push(mesh);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: 0x4d6234, transparent: true, opacity: 0.3 }));
      mesh.add(edges);
    }
    scene.updateMatrixWorld(true);
    const bounds = new THREE.Box3();
    for (const mesh of meshes) if (mesh.parent?.visible) bounds.expandByObject(mesh);
    const center = bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3());
    const extent = bounds.isEmpty() ? 0.1 : Math.max(bounds.getSize(new THREE.Vector3()).length(), 0.001);
    camera.near = Math.max(extent / 10000, 0.000001); camera.far = Math.max(extent * 1000, 100); camera.updateProjectionMatrix();
    camera.position.copy(center).add(new THREE.Vector3(1.2, -1.5, 1.1).multiplyScalar(extent)); controls.target.copy(center);
    const grid = new THREE.GridHelper(extent * 3, 20, 0xa6ad9b, 0xd5dbcd); grid.rotateX(Math.PI / 2);
    grid.position.set(center.x, center.y, bounds.isEmpty() ? 0 : bounds.min.z - extent * 0.015); scene.add(grid);
    const axes = new THREE.AxesHelper(extent * 0.2); scene.add(axes);
    const resize = new ResizeObserver(() => {
      const width = element.clientWidth, height = element.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix();
    }); resize.observe(element);
    const ray = new THREE.Raycaster(), pointer = new THREE.Vector2();
    let down: [number, number] = [0, 0];
    const press = (event: PointerEvent) => { down = [event.clientX, event.clientY]; };
    const pick = (event: PointerEvent) => {
      if (Math.hypot(event.clientX - down[0], event.clientY - down[1]) > 5) return;
      const box = renderer.domElement.getBoundingClientRect();
      pointer.set((event.clientX - box.left) / box.width * 2 - 1, -(event.clientY - box.top) / box.height * 2 + 1);
      ray.setFromCamera(pointer, camera);
      const hit = ray.intersectObjects(meshes, false).find(h => h.object.parent?.visible);
      if (hit) live.current.onSelect(String(hit.object.userData.entity));
    };
    renderer.domElement.addEventListener("pointerdown", press); renderer.domElement.addEventListener("pointerup", pick);
    let animation = 0;
    const render = () => {
      const state = live.current, current = state.frame;
      for (const body of workspace.scene.bodies) {
        const group = bodies.get(body.entity_ref)!, value = current?.body_poses[body.entity_ref] ?? body.world_pose;
        group.visible = !!value; if (value) pose(group, value);
      }
      const collisions = new Set((current?.collisions ?? workspace.scene.collisions).flat());
      for (const mesh of meshes) {
        const id = String(mesh.userData.entity), hit = state.collision && collisions.has(id);
        mesh.material.color.set(hit ? "#dc624e" : state.selected === id ? "#4c8b9f" : mesh.userData.purpose === "solid" ? "#a8bf72" : "#d7b969");
        mesh.material.wireframe = state.collision && !hit;
        mesh.material.transparent = mesh.userData.purpose !== "solid"; mesh.material.opacity = mesh.material.transparent ? 0.4 : 1;
      }
      controls.update(); renderer.render(scene, camera); animation = requestAnimationFrame(render);
    }; render();
    return () => {
      cancelAnimationFrame(animation); resize.disconnect(); controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", press); renderer.domElement.removeEventListener("pointerup", pick);
      scene.traverse(object => {
        const item = object as THREE.Mesh;
        item.geometry?.dispose();
        if (item.material) for (const material of Array.isArray(item.material) ? item.material : [item.material]) material.dispose();
      });
      renderer.dispose(); renderer.domElement.remove();
    };
  }, [workspace]);
  return <div className="engine-canvas-wrap"><div ref={host} className="engine-canvas" />
    {error && <p className="engine-overlay">{t("WebGL 不可用；可继续查看电路、诊断或下载结果。", "WebGL unavailable. Circuit, diagnostics and downloads remain available.")}</p>}
    {!workspace.scene.envelopes.length && <p className="engine-overlay">{t("此模型没有几何包络，请切换至电路逻辑视图。", "This model has no envelopes. Open the circuit view.")}</p>}
    <span className="viewer-help">{t("拖动旋转 · 滚轮缩放 · 点击元件查看 · 单位 m", "Drag to orbit · Scroll to zoom · Click to inspect · Units: m")}</span>
  </div>;
}
