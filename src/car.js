import * as T from '../public/vendor/three.js';
const glass = new T.MeshPhysicalMaterial({ color:'#485963',metalness:.25,roughness:.12,transparent:true,opacity:.76,depthWrite:false });
const rims = new T.MeshStandardMaterial({ color:'#737b80',metalness:1,roughness:.27 });
const rubber = new T.MeshStandardMaterial({ color:'#191b1c',roughness:.94 });
const leather = new T.MeshStandardMaterial({ color:'#39332e',roughness:.82 });

// Artist model is shared; only the paint is unique per vehicle.
export function createCar(template, color = '#b62018') {
  if (!template?.isObject3D) throw new TypeError('A loaded car model is required');
  const car = new T.Group(), model = template.clone(true);
  const paint = new T.MeshPhysicalMaterial({ color, metalness: .65, roughness: .26, clearcoat: 1, clearcoatRoughness: .12 });
  const brakeMaterial=new T.MeshStandardMaterial({color:'#8e1712',emissive:'#dc2517',emissiveIntensity:.05,roughness:.35});
  model.traverse(node => {
    if (!node.isMesh) return;
    node.castShadow = true; node.receiveShadow = true;
    if (node.name === 'body') node.material = paint;
    if (node.name === 'lights_red') node.material = brakeMaterial;
    if (node.name === 'glass') node.material = glass;
    if (/^rim_|^chrome$/.test(node.name)) node.material = rims;
    if (node.name === 'tire') node.material = rubber;
    if (['leather','interior_light','carpet'].includes(node.name)) node.material = leather;
  });
  const box = new T.Box3().setFromObject(model), size = box.getSize(new T.Vector3());
  if (!Number.isFinite(size.z) || size.z <= 0) throw new TypeError('Car model has no finite length');
  model.scale.multiplyScalar(4.7 / size.z);
  const scaled = new T.Box3().setFromObject(model), center = scaled.getCenter(new T.Vector3());
  model.position.x -= center.x; model.position.z -= center.z; model.position.y -= scaled.min.y;
  car.add(model);
  car.userData.wheels = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'].map(name => model.getObjectByName(name)).filter(Boolean);
  car.userData.paint = paint;
  car.userData.brakeMaterial = brakeMaterial;
  return car;
}
