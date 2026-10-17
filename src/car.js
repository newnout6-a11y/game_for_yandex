import * as T from '../public/vendor/three.js';
const glass = new T.MeshPhysicalMaterial({ color:'#485963',metalness:.25,roughness:.12,transparent:true,opacity:.76,depthWrite:false });
const rims = new T.MeshStandardMaterial({ color:'#737b80',metalness:1,roughness:.27 });
const rubber = new T.MeshStandardMaterial({ color:'#191b1c',roughness:.94 });

// Artist model is shared; only the paint is unique per vehicle.
/**
 * Clone an authored player hierarchy, normalize its length to 4.7 metres and ground it at Y=0.
 * The result is centered on X/Z and retains the source orientation. Geometry and untouched
 * materials remain shared with the template; paint and brake materials are unique to this car.
 * Wheel pivots, the 0.34-metre wheel radius and mutable materials are exposed through userData.
 * @param {T.Object3D} template - Loaded scene with finite positive Z extent; never transformed in place.
 * @param {T.ColorRepresentation} [color='#b62018'] - Initial per-car body paint.
 * @returns {T.Group} New grounded vehicle hierarchy for animation.
 * @throws {TypeError} If the template is absent or has no finite positive length.
 */
export function createCar(template, color = '#b62018') {
  if (!template?.isObject3D) throw new TypeError('A loaded car model is required');
  const car = new T.Group(), model = template.clone(true);
  const paint = new T.MeshPhysicalMaterial({ color, metalness: .65, roughness: .26, clearcoat: 1, clearcoatRoughness: .12 });
  const brakeMaterial=new T.MeshStandardMaterial({color:'#8e1712',emissive:'#dc2517',emissiveIntensity:.05,roughness:.35});
  model.traverse(node => {
    if (!node.isMesh) return;
    node.castShadow = true; node.receiveShadow = true;
    if (/^body(?:_|$)/.test(node.name) || /^body(?:_|$)/.test(node.material?.name||'')) { paint.side=node.material?.side??T.FrontSide;node.material = paint; }
    if (/^lights_red(?:_|$)/.test(node.name) || /^lights_red(?:_|$)/.test(node.material?.name||'')) node.material = brakeMaterial;
    // Preserve authored Roadster glazing and interior materials; legacy templates
    // still use their exact established material names.
    if (node.name === 'glass' && !node.material?.name) node.material = glass;
    if (/^rim_|^chrome$/.test(node.name)) node.material = rims;
    if (node.name === 'tire') node.material = rubber;

  });
  const box = new T.Box3().setFromObject(model), size = box.getSize(new T.Vector3());
  if (!Number.isFinite(size.z) || size.z <= 0) throw new TypeError('Car model has no finite length');
  model.scale.multiplyScalar(4.7 / size.z);
  const scaled = new T.Box3().setFromObject(model), center = scaled.getCenter(new T.Vector3());
  model.position.x -= center.x; model.position.z -= center.z; model.position.y -= scaled.min.y;
  car.add(model);
  car.userData.wheels = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'].map(name => model.getObjectByName(name)).filter(Boolean);
  car.userData.paint = paint;
  car.userData.wheelRadius = .34;
  car.userData.brakeMaterial = brakeMaterial;
  return car;
}
