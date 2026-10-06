/**
 * Off-axis perspective through a fixed, axis-aligned display rectangle.
 * Eye motion changes the asymmetric frustum, never the display's orientation.
 * Derivation: Robert Kooima, Generalized Perspective Projection (2009).
 * No lookAt() is used in this mode: rotating the eye would move the window.
 */
export function updateWindowCamera(camera, {width, height, centerY = 6, screenZ = 0, eyeX = 0, eyeY = 6, eyeZ = 22, near = .1, far = 120}) {
  const distance = Math.max(.5, eyeZ - screenZ);
  const scale = near / distance;
  const left = (-width / 2 - eyeX) * scale;
  const right = (width / 2 - eyeX) * scale;
  const bottom = (centerY - height / 2 - eyeY) * scale;
  const top = (centerY + height / 2 - eyeY) * scale;
  camera.position.set(eyeX, eyeY, screenZ + distance);
  camera.quaternion.identity();
  camera.near = near;
  camera.far = far;
  camera.aspect = width / height;
  camera.projectionMatrix.makePerspective(left, right, top, bottom, near, far);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  camera.updateMatrixWorld(true);
  return {left, right, top, bottom, distance, width, height, centerY, screenZ, eyeX, eyeY, eyeZ: screenZ + distance};
}

export function damp(current, target, speed, dt) {
  return current + (target - current) * (1 - Math.exp(-speed * dt));
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
