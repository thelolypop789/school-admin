// @ts-nocheck — ฉากแผนที่โรงเรียน (อาคาร สนาม ถนน ต้นไม้) มาจากแผนที่ของ ekk028 (repo ekk028/21-school-map, school-map.html)
// ได้รับอนุญาตให้ใช้แล้ว · ส่วนฉากคัดมาแทบไม่แก้ เพื่อเทียบ/อัปเดตตามต้นฉบับได้ง่าย (คั่นด้วยเครื่องหมาย ===== ฉากจาก 21-school-map)
// พิกัด: พิกเซลบนภาพดาวเทียม (0.3485 ม./พิกเซล ทิศเหนือขึ้น) → เมตร (+x ตะวันออก, +z ใต้)
// ส่วนที่เพิ่มสำหรับแอป (เขตทำความสะอาด, เลือก/วาดเขต, ปิดฉาก) อยู่ท้ายไฟล์
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

export const PX_PER_M = 1 / 0.3485;

/** สร้างฉาก 3 มิติใน stage (div ที่มีขนาด) — throw ถ้าเบราว์เซอร์ไม่มี WebGL */
export function createCampus(stage, opts = {}) {
  /* ---------------------------------------------------------------
     Coordinates: every footprint below is traced in pixels on a
     satellite mosaic (0.3485 m per pixel, north up). World units are
     metres: +x = east, +z = south, +y = up.
  ---------------------------------------------------------------- */
  const S = 0.3485, OX = 540, OY = 600;
  const wx = px => (px - OX) * S;
  const wz = py => (py - OY) * S;
  const HD = false;
  const COURT_BX = 403;                                                           // west slab: basketball 28 × 15 m
  const mkCourt = (cx, cy, wm, hm) => [cx - wm / S / 2, cy - hm / S / 2, cx + wm / S / 2, cy + hm / S / 2];
  const VB_COURT = [mkCourt(540, 410, 9, 18)];                                    // volleyball 9 × 18 m
  const TK_COURTS = [mkCourt(569, 410, 6.1, 13.4), mkCourt(594, 410, 6.1, 13.4)]; // sepak takraw 6.1 × 13.4 m, side by side
  const FARM = [334, 858, 410, 998];                                              // school vegetable plot east of the pond (user circled it on the map)
  const BEACH = mkCourt(231, 737, 16, 8);                                         // beach volleyball 16 × 8 m (sand patch south of the track, by the pond)
  const PETANQUE =[[452, 304], [492, 304], [452, 318], [492, 318]].map(([cx, cy]) => mkCourt(cx, cy, 12, 3));   // pétanque 12 × 3 m
  const EXPORT = false;
  const NARROW = matchMedia('(max-width: 760px)').matches;
  const LOW = !EXPORT && (NARROW || (navigator.hardwareConcurrency || 8) <= 4);
  const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- small helpers ---------- */
  function rng(seed){ let a = seed; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function rgbOf(h){ const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function mix(h, to, t){ const a = rgbOf(h), b = rgbOf(to); return 'rgb(' + a.map((v, i) => Math.round(v * (1 - t) + b[i] * t)).join(',') + ')'; }
  const dk = (h, t) => mix(h, '#000000', t);
  const lt = (h, t) => mix(h, '#ffffff', t);
  function inPoly(x, y, poly){ let ins = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++){ const [xi, yi] = poly[i], [xj, yj] = poly[j]; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) ins = !ins; } return ins; }
  function segDist(px, py, ax, ay, bx, by){ const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy; let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(ax + t * dx - px, ay + t * dy - py); }

  // ===== ฉากจาก 21-school-map: ข้อมูลพื้นที่ =====
/* ---------- site data (mosaic pixels) ---------- */
const ROADS = [
  { w: 7.0, c: '#686b68', e: '#a88f6d', pts: [[-1400,212],[0,204],[400,196],[800,186],[1800,168]] },          // ถนนสายหลักหน้าโรงเรียน (ลาดยาง)
  { w: 4.5, c: '#c4a17a', e: '#a0845f', pts: [[402,196],[404,0],[407,-1200]] },
  { w: 5.0, c: '#c9a57d', e: '#a3845f', pts: [[-8,206],[8,320],[28,480],[48,650],[66,800],[90,1000],[104,1161],[130,1900]] },
  { w: 5.0, c: '#cfcabe', e: '#a29e92', pts: [[366,198],[367,260],[377,350],[391,460],[404,600],[416,760],[426,870],[432,962]] }, // ถนนภายใน
  { w: 4.5, c: '#cfcabe', e: '#a29e92', pts: [[432,964],[520,964],[600,959],[700,948],[745,946]] },     // ถนนปูนบ้านพักครู ต่อกับถนนภายใน (ผู้ใช้ยืนยัน)
  { w: 4.5, c: '#b8744c', e: '#955b3a', pts: [[97,1076],[420,1082],[738,1090]] },            // ถนนแดงหลังโรงเรียน ไม่เชื่อมกับอะไร
  { w: 4.5, c: '#cfcabe', e: '#a29e92', pts: [[642,290],[644,450],[650,600],[662,650],[665,800],[670,860],[672,947]] },    // ถนนปูนฝั่งตะวันออก ไปบ้านพักครู (ผู้ใช้ยืนยัน)
  { w: 4.0, c: '#d6d1c6', e: '#aaa599', pts: [[368,292],[642,290]] },
  { w: 3.5, c: '#d6d1c6', e: '#aaa599', pts: [[386,455],[644,452]] },
  { w: 6.0, c: '#d6d1c6', e: '#aaa599', pts: [[404,603.5],[650,603.5]] },   // ถนนระหว่างโดมกับอาคาร 1 รถสวนกันได้ (ผู้ใช้บอก 22 พ.ย.) · ขยับโดมขึ้นเหนือ 17 หน่วยเพื่อเปิดทาง
  { w: 4.5, c: '#d6d1c6', e: '#aaa599', pts: [[417,778],[665,778]] },
  { w: 4.5, c: '#c4a17a', e: '#9f835f', pts: [[424,887],[670,887]] },   // ถนนลูกรัง/ลานจอดรถหลังอาคาร 3 (ผู้ใช้ระบุ)
  { w: 2.0, c: '#d6d1c6', e: '#aaa599', pts: [[536,657],[536,701]] },
  { w: 2.0, c: '#d6d1c6', e: '#aaa599', pts: [[545,753],[545,818]] },
  { w: 3.0, c: '#c4a17a', e: '#9f835f', pts: [[412,802],[330,802],[322,850],[322,975]] },
  { w: 3.0, c: '#c4a17a', e: '#9f835f', pts: [[80,850],[150,850],[322,850]] },   // จากสระไปถนนด้านซ้าย
  { w: 3.0, c: '#c4a17a', e: '#9f835f', pts: [[81,925],[155,925]] },            // ทางออกด้านตะวันตกของสระ
];
const CLEAR = [
  [[80,432],[116,432],[116,654],[80,654]],   // แนวสแตนเชียร์สีริมสนามฟุตบอลด้านตะวันตก ไม่ให้มีต้นไม้ทับ
  [[352,214],[735,204],[733,540],[766,556],[772,1012],[600,1010],[430,1012],[356,872],[343,560],[334,300],[342,216]],
  [[92,318],[118,300],[334,298],[343,560],[354,870],[332,846],[150,846],[112,792],[95,700]],
  [[146,846],[338,842],[345,1000],[150,1006]],
  [[168,92],[398,86],[398,186],[168,192]],
  [[330,854],[432,854],[432,1002],[330,1002]],   // แปลงเกษตรข้างสระ
];
const PALETTE = {
  grassDry:'#93a562', lawn:'#7ea552', field:'#7f9b53', floor:'#526638', concrete:'#cdc9bf', track:'#b37b56',
};

  /* ---------- renderer / scene ---------- */
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, LOW ? 1.5 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  stage.appendChild(renderer.domElement);
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = 'labels';
  stage.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  const world = new THREE.Group(); world.name = 'WangLuangPittayasan'; scene.add(world);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 5000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.495; controls.minDistance = 6; controls.maxDistance = 900;
  controls.screenSpacePanning = false; controls.autoRotateSpeed = 0.6;
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  /* sky */
  const skyU = { top: { value: new THREE.Color('#5f9bd3') }, hor: { value: new THREE.Color('#dde8ec') } };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(2400, 32, 16), new THREE.ShaderMaterial({
    uniforms: skyU, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 hor; varying vec3 vP; void main(){ float h = clamp(vP.y,0.0,1.0); gl_FragColor = vec4(mix(hor, top, pow(h,0.5)), 1.0);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}'
  }));
  sky.renderOrder = -3; scene.add(sky);   // วาดก่อนสุด: หญ้ารอบนอก (-2) และถนน (-1) ไม่เขียน depth ต้องวาดทับฟ้า
  scene.fog = new THREE.Fog(0xdde8ec, 460, 1700);

  /* lights */
  const hemi = new THREE.HemisphereLight(0xe3efff, 0x5c6b3d, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0dc, 2.6);
  const SUN_TARGET = new THREE.Vector3(-45, 0, 0);
  sun.target.position.copy(SUN_TARGET);
  sun.castShadow = true;
  sun.shadow.mapSize.set(LOW ? 2048 : 4096, LOW ? 2048 : 4096);
  Object.assign(sun.shadow.camera, { left: -235, right: 235, top: 235, bottom: -235, near: 50, far: 1400 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.5;
  scene.add(sun, sun.target);

  // ===== ฉากจาก 21-school-map: พื้น อาคาร ของประกอบ ต้นไม้ =====
function canvasTex(c){ const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = Math.min(8, maxAniso); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; }

/* ---------- ground (painted canvas) ---------- */
const GR = { x0: -270, z0: -228, size: 450 };
function paintGround(res){
  const c = document.createElement('canvas'); c.width = c.height = res;
  const g = c.getContext('2d'); const k = res / GR.size; const r = rng(11);
  g.fillStyle = PALETTE.floor; g.fillRect(0, 0, res, res);
  for (let i = 0; i < res * res / 220; i++){
    const s = (1 + r() * 3) * res / 2048; g.fillStyle = r() < 0.55 ? 'rgba(28,40,18,.22)' : 'rgba(150,150,95,.10)';
    g.fillRect(r() * res, r() * res, s, s);
  }
  g.setTransform(S * k, 0, 0, S * k, (-OX * S - GR.x0) * k, (-OY * S - GR.z0) * k);
  const m = 1 / S;
  const poly = (pts, fill) => { g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.fillStyle = fill; g.fill(); };
  const rect = (x0, y0, x1, y1, fill) => { g.fillStyle = fill; g.fillRect(x0, y0, x1 - x0, y1 - y0); };

  // clearings (open ground)
  g.save(); g.filter = 'blur(2px)';
  CLEAR.forEach(p => poly(p, PALETTE.grassDry));
  g.restore();
  // grass texture in clearings
  g.save(); g.beginPath(); CLEAR.forEach(p => { p.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); }); g.clip();
  for (let i = 0; i < 26000; i++){ const x = r() * 900 - 50, y = r() * 1100; g.fillStyle = r() < 0.5 ? 'rgba(70,90,35,.16)' : 'rgba(205,195,140,.13)'; g.fillRect(x, y, 1 + r() * 3, 1 + r() * 3); }
  g.restore();

  // managed lawns
  [[435,657,633,700],[443,760,633,772],[443,784,633,812],[380,300,516,380],[618,300,640,380],[440,279,640,289],[655,556,740,660],[505,562,640,600],[685,780,760,900]].forEach(a => rect(...a, PALETTE.lawn));
  // bare yard south of hall
  rect(505, 566, 632, 600, '#a9a172');

  // track and field
  const oval = (cx, y0, y1, rr) => { g.moveTo(cx - rr, y0 + rr); g.arc(cx, y0 + rr, rr, Math.PI, 0); g.lineTo(cx + rr, y1 - rr); g.arc(cx, y1 - rr, rr, 0, Math.PI); g.closePath(); };
  g.beginPath(); oval(211, 318, 789, 109); oval(211, 339, 768, 88); g.fillStyle = PALETTE.track; g.fill('evenodd');
  g.beginPath(); oval(211, 339, 768, 88); g.fillStyle = PALETTE.field; g.fill();
  for (let i = 0; i < 12; i++){ const y = 409 + i * 24; rect(123, y, 299, y + 12, 'rgba(255,255,255,.06)'); }
  g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 0.18 * m;
  for (let j = 1; j < 6; j++){ g.beginPath(); oval(211, 318 + j * 3.5, 789 - j * 3.5, 109 - j * 3.5); g.stroke(); }
  g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 0.28 * m;
  g.strokeRect(119, 409.5, 184, 287);
  g.beginPath(); g.moveTo(119, 553); g.lineTo(303, 553); g.stroke();
  g.beginPath(); g.arc(211, 553, 26, 0, Math.PI * 2); g.stroke();
  g.strokeRect(153, 409.5, 116, 47.3); g.strokeRect(153, 649.2, 116, 47.3);
  g.strokeRect(184.8, 409.5, 52.5, 15.8); g.strokeRect(184.8, 680.7, 52.5, 15.8);
  rect(200, 724, 262, 750, '#dccb9e');  // ลานทรายท้ายลู่วิ่ง = สนามวอลเลย์บอลชายหาด 16 × 8 ม.
  g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 0.1 * m;
  g.strokeRect(BEACH[0], BEACH[1], BEACH[2] - BEACH[0], BEACH[3] - BEACH[1]);
  g.beginPath(); g.moveTo((BEACH[0] + BEACH[2]) / 2, BEACH[1]); g.lineTo((BEACH[0] + BEACH[2]) / 2, BEACH[3]); g.stroke();

  // roads (edge first, then surface)
  g.lineCap = 'round'; g.lineJoin = 'round';
  ROADS.forEach(rd => { g.beginPath(); rd.pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.strokeStyle = rd.e; g.lineWidth = (rd.w + 1.4) * m; g.stroke(); });
  ROADS.forEach(rd => { g.beginPath(); rd.pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.strokeStyle = rd.c; g.lineWidth = rd.w * m; g.stroke(); });

  // courts
  // สนามบาสเกตบอล (ย้ายมาฝั่งตะวันตก) 28 × 15 ม.
  const BX = COURT_BX;
  rect(BX, 380, BX + 92, 440, '#2f78bf');
  rect(BX + 5.8, 402, BX + 22.4, 419, '#e39540'); rect(BX + 69.6, 402, BX + 86.2, 419, '#e39540');
  g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 0.14 * m;
  g.strokeRect(BX + 5.8, 388.5, 80.4, 43); g.beginPath(); g.moveTo(BX + 46, 388.5); g.lineTo(BX + 46, 431.5); g.stroke();
  g.beginPath(); g.arc(BX + 46, 410, 5.2, 0, Math.PI * 2); g.fillStyle = '#e8b62c'; g.fill(); g.lineWidth = 0.5 * m; g.strokeStyle = '#b3302a'; g.stroke();
  g.lineWidth = 0.14 * m; g.strokeStyle = 'rgba(255,255,255,.9)';
  g.beginPath(); g.arc(BX + 5.8, 410, 19.2, -Math.PI / 2.3, Math.PI / 2.3); g.stroke();
  g.beginPath(); g.arc(BX + 86.2, 410, 19.2, Math.PI - Math.PI / 2.3, Math.PI + Math.PI / 2.3); g.stroke();

  // ลานวอลเลย์บอล 1 + ตะกร้อ 2 (ขนาดจริง วอลเลย์ 9 × 18 ม. · ตะกร้อ 6.1 × 13.4 ม.)
  rect(520, 380, 612, 440, '#a3a6a0');
  g.strokeStyle = 'rgba(255,255,255,.92)'; g.lineWidth = 0.1 * m;
  VB_COURT.forEach(([x0, y0, x1, y1]) => {
    rect(x0, y0, x1, y1, '#e0823a'); g.strokeRect(x0, y0, x1 - x0, y1 - y0);
    const cy = (y0 + y1) / 2; g.beginPath(); g.moveTo(x0, cy); g.lineTo(x1, cy); g.stroke();
    [-3, 3].forEach(d => { g.beginPath(); g.moveTo(x0, cy + d * m); g.lineTo(x1, cy + d * m); g.stroke(); });
  });
  TK_COURTS.forEach(([x0, y0, x1, y1]) => {
    rect(x0, y0, x1, y1, '#4f9a7a'); g.strokeRect(x0, y0, x1 - x0, y1 - y0);
    const cy = (y0 + y1) / 2; g.beginPath(); g.moveTo(x0, cy); g.lineTo(x1, cy); g.stroke();
    g.beginPath(); g.arc((x0 + x1) / 2, y0 + 3.05 * m, 0.3 * m, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc((x0 + x1) / 2, y1 - 3.05 * m, 0.3 * m, 0, Math.PI * 2); g.stroke();
  });

  // สนามเปตอง 4 สนาม 12 × 3 ม. (พื้นลูกรังขอบไม้)
  PETANQUE.forEach(([x0, y0, x1, y1]) => { rect(x0 - 0.3 * m, y0 - 0.3 * m, x1 + 0.3 * m, y1 + 0.3 * m, '#8a6a3e'); rect(x0, y0, x1, y1, '#cdb98a'); });
  // dome floor + futsal lines
  rect(425, 461, 502, 595, '#7890a6');
  g.strokeRect(435, 471, 57, 114); g.beginPath(); g.moveTo(435, 528); g.lineTo(492, 528); g.stroke();
  g.beginPath(); g.arc(463.5, 528, 8.6, 0, Math.PI * 2); g.stroke();

  // แปลงเกษตร: ดินแปลงผักเป็นร่อง ๆ
  rect(FARM[0], FARM[1], FARM[2], FARM[3], '#85623f');
  for (let x = FARM[0] + 4; x + 6 < FARM[2] - 3; x += 10){
    rect(x, FARM[1] + 5, x + 6, FARM[3] - 5, '#62973f');
    rect(x + 1.1, FARM[1] + 5, x + 1.9, FARM[3] - 5, '#4b7d2d'); rect(x + 4.1, FARM[1] + 5, x + 4.9, FARM[3] - 5, '#4b7d2d');
  }

  // concrete aprons under every roof
  BUILDINGS.forEach(b => { if (b.noApron) return; const [x0, y0, x1, y1] = b.rect; const p = 0.6 / S; rect(x0 - p, y0 - p, x1 + p, y1 + p, PALETTE.concrete); });
  // pond bank + water colour
  g.beginPath(); g.roundRect(151, 853, 173, 146, 16); g.fillStyle = '#6a5a3f'; g.fill();
  g.beginPath(); g.roundRect(155, 857, 165, 138, 13); g.fillStyle = '#35584b'; g.fill();
  return c;
}

/* ---------- building data (traced from satellite; names from school site) ---------- */
const STY108 = { floors: 2, fh: 3.5, cor: 's', roofType: 'gable', pitch: 22, ov: 1.2, wall: '#efe5cf', trim: '#9f4b31', col: '#efe5cf', glass: '#4a5a6b', roof: '#6c6863' };
const HOUSE = { floors: 2, fh: 2.8, base: 0.3, pilotis: true, style: 'house', roofType: 'gable', pitch: 28, ov: 0.7, wall: '#e8896b', trim: '#f3eee4', col: '#f3eee4', glass: '#40464f', bay: 3.2, noApron: true };
const AUX = { floors: 1, fh: 3.3, style: 'plain', roofType: 'gable', pitch: 24, ov: 0.8, wall: '#f0ede4', trim: '#8f8a80', col: '#f0ede4', bay: 3.5 };
const BUILDINGS = [
  { id: 'A', rect: [440,239,672,278], floors: 3, fh: 3.75, base: 0.7, pilotis: true, openGround: true, fitness: { w: 8, end: -1 }, cor: 's', towers: { off: 14, w: 4.4, dep: 3.6, low: true }, endWallW: '#a9d8ee', roofType: 'hip', pitch: 24, ov: 2.2, wall: '#f5f7f7', trim: '#5fb2d8', col: '#5fb2d8', glass: '#40627d', roof: '#7a3a35', label: 'อาคาร 4 (216ก)' },
  { id: 'G', rect: [453,818,637,857], floors: 3, fh: 3.5, cor: 'n', towers: { off: 14, w: 4.4, dep: 3.6, flat: true }, awnings: true, recess: '#c95a3d', roofType: 'gable', pitch: 22, ov: 1.3, wall: '#ece4d0', trim: '#b9b5a8', col: '#e3dcc8', glass: '#27323a', roof: '#e8745f', label: 'อาคาร 3 (216ค)' },
  { id: 'E', rect: [435,612,633,655], ...STY108, pitch: 12, ov: 1.9, trim: '#cf6a2c', col: '#d9783a', awnBack: '#e4dfd2', label: 'อาคาร 1 (108ล)' },   // ภาพจริง #01/#02 (C ยืนยัน 22 พ.ย.): หลังคาลาดต่ำ ชายคายื่นลึก
  { id: 'F', rect: [443,702,633,752], ...STY108, label: 'อาคาร 2 (108ล)' },
  { id: 'C', rect: [502,470,632,552], floors: 1, fh: 7.2, style: 'hall', roofType: 'gable', monitor: true, pitch: 18, ov: 0.8, wall: '#f1ede3', trim: '#7a3b2b', col: '#7a3b2b', glass: '#3b4046', roof: '#5f6366', bay: 4.5, label: 'หอประชุม' },
  { id: 'Cn', rect: [502,462,632,471], roofType: 'shed', open: true, shedHi: 4.4, shedLo: 3.6, lean: 'n', roof: '#3f78c9', trim: '#7a3b2b', part: 'C' },
  { id: 'Cs', rect: [502,551,632,560], roofType: 'shed', open: true, shedHi: 4.4, shedLo: 3.6, lean: 's', roof: '#3f78c9', trim: '#7a3b2b', part: 'C' },
  { id: 'D', rect: [440,461,487,595], open: true, fh: 6.8, floors: 1, base: 0.15, roofType: 'arch', archRise: 4.0, ov: 0.5, roof: '#dde2e5', trim: '#8e969c', axis: 'z', label: 'โดม · สนามฟุตซอล', noApron: true },
  // ชายคาข้างโดม 2 ด้าน (หลังคาเหล็กลาดต่ำ ต่อจากโค้งกลาง) ตามภาพถ่ายภายในโดม
  { id: 'Dw', rect: [425,461,440,595], open: true, roofType: 'shed', shedHi: 6.8, shedLo: 4.8, lean: 'e', roof: '#cfd3d6', trim: '#8e969c', part: 'D', noApron: true },
  { id: 'De', rect: [487,461,502,595], open: true, roofType: 'shed', shedHi: 6.8, shedLo: 4.8, lean: 'w', roof: '#cfd3d6', trim: '#8e969c', part: 'D', noApron: true },
  { id: 'B', rect: [517,325,617,377], ...AUX, fh: 4.2, trim: '#2f6fc0', roof: '#2f6fc0', bay: 4, label: 'อาคารนาฏศิลป์ · ดนตรี' },
  { id: 'H', rect: [663,408,722,530], open: true, floors: 1, fh: 5.6, style: 'hall2', roofType: 'gable', pitch: 14, ov: 1, wall: '#e8e5dc', trim: '#8e8f89', col: '#8e8f89', roof: '#c5c9cb', bay: 5, label: 'โรงอาหาร' },
  { id: 'A2', rect: [397,235,432,270], ...AUX, roof: '#58b6cf', trim: '#58b6cf' },
  { id: 'I1', rect: [660,350,678,380], ...AUX, roof: '#8b3d33', trim: '#8b3d33' },
  { id: 'I2', rect: [678,352,718,398], open: true, floors: 1, base: 0.15, fh: 5.2, roofType: 'arch', archRise: 2.6, ov: 0.6, roof: '#e6e9ea', trim: '#8e969c', axis: 'z', label: 'โดมสนามมวย' },   // เปิดโล่งไม่มีผนัง เวทีมวยกลางโดม (ผู้ใช้บอก)
  { id: 'J', rect: [682,662,715,755], ...AUX, fh: 3.6, roof: '#8a4436', trim: '#8a4436' },
  { id: 'Jw', rect: [671,662,682,755], roofType: 'shed', open: true, shedHi: 3.2, shedLo: 2.8, lean: 'w', roof: '#cfe2ee', trim: '#9aa3a8', part: 'J' },
  { id: 'T1', rect: [680,757,740,775], ...AUX, style: 'toilet', fh: 3, roof: '#2f6fc0', trim: '#2f6fc0', wall: '#f4f4f1' },
  { id: 'T2', rect: [670,625,700,650], ...AUX, style: 'toilet', fh: 3, roof: '#2f6fc0', trim: '#2f6fc0', wall: '#f4f4f1', label: 'ห้องน้ำ นร.หญิง' },
  { id: 'T3', rect: [700,530,740,550], ...AUX, roof: '#3474c4', trim: '#3474c4', label: 'ห้องน้ำ นร.ชาย' },
  { id: 'K1', rect: [640,632,654,660], ...AUX, roof: '#8f4538', trim: '#8f4538' },
  { id: 'K2', rect: [642,668,655,700], ...AUX, roof: '#cfd3d4' },
  { id: 'L1', rect: [453,895,615,914], open: true, floors: 1, roofType: 'shed', shedHi: 3.6, shedLo: 2.8, lean: 's', ov: 0.4, roof: '#6e3a33', trim: '#6e3a33', label: 'โรงรถครู' },   // เพิงหมาแหงน โปร่ง (ผู้ใช้บอก 22 พ.ย.) · ทิศลาดเดา
  { id: 'L2', rect: [615,895,637,914], open: true, floors: 1, roofType: 'shed', shedHi: 3.6, shedLo: 2.8, lean: 's', ov: 0.4, roof: '#e7e9e6', trim: '#6e3a33', part: 'L1' },
  { id: 'M1', rect: [689,212,710,326], open: true, floors: 1, roofType: 'shed', shedHi: 3.3, shedLo: 2.8, lean: 'w', roof: '#d4d6d2', trim: '#8f949a', label: 'ที่จอดรถมอเตอร์ไซค์' },
  // ห้องน้ำ นร.หญิง 4 ที่/49 2 หลัง (ผู้ใช้ทำดาวแดงบนภาพ) · แบบส้วม 4 ที่/49 หลังคาปั้นหยา ราว 5 × 3 ม. (รวมชายคาราว 7.4 × 5.4 ม.)
  { id: 'S1', rect: [737,796,759,812], ...AUX, style: 'toilet', fh: 3, roofType: 'hip', pitch: 28, ov: 1.1, wall: '#efe9d6', roof: '#2f6fc0', trim: '#2f6fc0', label: 'ห้องน้ำ นร.หญิง (ใหม่)' },
  { id: 'S2', rect: [739,847,761,863], ...AUX, style: 'toilet', fh: 3, roofType: 'hip', pitch: 28, ov: 1.1, wall: '#efe9d6', roof: '#2f6fc0', trim: '#2f6fc0', label: 'ห้องน้ำ นร.ชาย (ใหม่)' },
  // ศาลาข้างสนามบาส (ทิศใต้ของสนาม ตรงข้ามโดมโดยมีถนนคั่น) + ตู้กดน้ำกระป๋องด้านซ้าย — ขนาดประมาณ ผู้ใช้บอกตำแหน่งด้วยคำพูด
  { id: 'P1', rect: [452,434,488,446], open: true, floors: 1, roofType: 'shed', shedHi: 3.6, shedLo: 3.0, lean: 'n', roof: '#b9bdc1', trim: '#8f949a' },
  { id: 'V1', rect: [443,436,449,443], ...AUX, fh: 2.2, roofType: 'gable', pitch: 10, ov: 0.1, wall: '#d85a45', roof: '#c9483a', trim: '#c9483a', label: 'ตู้กดน้ำกระป๋อง (Sundew)' },
  // ซุ้มร้านน้ำ Sundew หลังคาทรงไทยสีขาว แถบเขียว-แดง ข้างต้นไม้ใหญ่ทางตะวันออกของอาคารนาฏศิลป์ (หน้าอาคาร 4) — ตำแหน่งประมาณจากภาพ
  { id: 'K3', rect: [628,362,637,371], ...AUX, fh: 2.4, pitch: 42, ov: 0.45, wall: '#f4f4ef', trim: '#2e8f4e', col: '#2e8f4e', roof: '#f6f6f2', bay: 3, label: 'ซุ้มน้ำ Sundew' },
  { id: 'W1', rect: [343,520,378,565], open: true, floors: 1, fh: 3.6, base: 0.55, roofType: 'hip', pitch: 30, ov: 1.2, roof: '#c9392d', trim: '#a8552b', label: 'ศาลาอินทนิล' },   // เปิดโล่ง พื้นยกสูงปูกระเบื้องน้ำเงิน หลังคาแดง (จากภาพถ่ายผู้ใช้)
  { id: 'W2', rect: [360,700,395,738], ...AUX, roof: '#2f6fc0', trim: '#2f6fc0', label: 'โรงน้ำ' },
  { id: 'W3', rect: [373,670,388,690], ...AUX, roof: '#5bbfd0', trim: '#5bbfd0', label: 'ตู้กดน้ำ' },
  { id: 'W4', rect: [340,810,383,845], ...AUX, roof: '#dfe6ea' },
  { id: 'W5', rect: [383,802,411,848], ...AUX, wall: '#d9744a', roof: '#2f6fc0', trim: '#2f6fc0', label: 'คาเฟ่เฮือนกาแฟ' },
  { id: 'W6', rect: [278,822,322,845], ...AUX, roof: '#b98a7a', trim: '#b98a7a' },
  { id: 'W7', rect: [197,826,218,843], ...AUX, roof: '#e9ebe8' },
  { id: 'W8', rect: [328,780,352,800], ...AUX, roof: '#9aa0a2' },
  // บ้านพักครู / บ้านพักแถวทิศใต้
  // ตำแหน่งตามภาพดาวเทียม (ผู้ใช้ส่งภาพซูม): แถวเหนือ 6 หลังเหนือถนน · แถวใต้ 4 หลังใต้ถนน
  ...[[464,936,498,957,'#6a665f'],[510,923,539,954,'#7b3e33'],[578,925,606,946,'#6a665f'],[611,919,649,943,'#5f6468'],[675,919,704,941,'#6a665f'],[723,909,753,936,'#6a665f'],
      [461,978,508,1003,'#6a665f'],[525,975,564,991,'#5f6468'],[635,958,662,994,'#6a665f'],[721,961,751,982,'#6a665f']]
    .map(([x0, y0, x1, y1, roof], i) => ({ id: 'h' + i, rect: [x0, y0, x1, y1], ...HOUSE, roof, part: 'houses' })),
  // บ้านเรือนนอกโรงเรียน ฝั่งเหนือของถนน
  { id: 'N1', rect: [185,145,212,180], ...AUX, roof: '#e2e4e2', part: 'outside' },
  { id: 'N2', rect: [268,108,295,175], ...AUX, roof: '#e6e7e3', part: 'outside' },
  { id: 'N3', rect: [318,130,362,178], ...AUX, roof: '#cfd2d2', part: 'outside' },
  { id: 'N4', rect: [360,108,393,170], ...AUX, roof: '#4d82c6', part: 'outside' },
];

/* ---------- info for the index ---------- */
const INFO = {
  A: { name: 'อาคาร 4 (แบบ 216ก)', kind: 'อาคารเรียนหลัก 3 ชั้น', src: 'site', facts: [['ห้องน้ำครู', 'หัว/ท้ายอาคาร ที่ชั้นบันไดขึ้นชั้น 2'], ['แบบมาตรฐาน', 'อาคารเรียน 216ล./57-ก (สพฐ.)'], ['ปีที่สร้าง', 'พ.ศ. 2557'], ['จำนวนชั้น', '3 ชั้น ชั้นล่างเปิดโล่ง'], ['ขนาดตามแบบ', 'ยาว 80 ม. (20 ช่วงเสา ช่วงละ 4 ม.)'], ['ในแบบ', 'บันไดกลาง 2 จุด · ห้องน้ำครูหัว/ท้ายอาคาร'], ['หลังคา', 'ทรงปั้นหยา สีแดงอิฐ'], ['ผนัง', 'สีขาว เสาและขอบสีฟ้า']], note: 'ชื่อ รูปทรง และสีจากภาพ “อาคารเรียนหลัก” และภาพมุมสูงบนเว็บไซต์โรงเรียน ตำแหน่งและขนาดวัดจากภาพดาวเทียม · ความยาว/บันได/ห้องน้ำเทียบกับแบบรูปรายการ สพฐ. ปีงบ 2562' },
  G: { name: 'อาคาร 3 (แบบ 216ค)', kind: 'อาคารเรียน 3 ชั้น', src: 'site', facts: [['ห้องน้ำครู', 'หัว/ท้ายอาคาร ที่ชั้นบันไดขึ้นชั้น 2'], ['ปีที่สร้าง', 'พ.ศ. 2540'], ['ห้องเรียน', 'ตามแบบ 16 ห้อง ใช้จริง 13 ห้อง ห้องพิเศษ 5 ห้อง'], ['งบประมาณ', '7,121,000 บาท'], ['ผังภายใน', 'เหมือนอาคาร 4 (216ล) บันไดกลาง 2 จุด ห้องน้ำหัว/ท้าย (ภายนอกต่างกัน)']], note: 'ข้อมูลอาคารจากเว็บไซต์โรงเรียน ตำแหน่งประเมินจากภาพมุมสูงเทียบกับภาพดาวเทียม หลังคาปัจจุบันในภาพดาวเทียมเป็นสีส้ม · ภาพถ่ายเก่าหน้าอาคารเห็นโครงคอนกรีต ชั้นล่างเป็นห้องเรียนหน้าต่างบานเกล็ดมีตะแกรง ระเบียงทางเดินเสาและพื้นคอนกรีตสีครีมเทา ปลายอาคารมีบล็อกคอนกรีตยื่นออก' },
  E: { name: 'อาคาร 1 (แบบ 108ล แถวเหนือ)', kind: 'อาคารเรียน 2 ชั้น', src: 'site', facts: [['ห้องน้ำครู', 'หัว/ท้ายอาคาร ที่ชั้นบันไดขึ้นชั้น 2'], ['ชั้นล่าง ปลายตะวันออก', 'มินิมาร์ท 2 ห้อง'], ['ปีที่สร้าง', 'พ.ศ. 2534 หรือ 2539'], ['ห้องเรียน', 'ตามแบบ 8 ห้อง'], ['งบประมาณ', '4,957,000 บาท']], note: 'โรงเรียนมีอาคาร 108ล สองหลัง สร้างปี 2534 และ 2539 ยังระบุไม่ได้ว่าหลังไหนสร้างปีใด · ชุดแบบ สพฐ. 2562 มีแต่ 108ล รุ่นใหม่ (59-ก ยาว 72 ม. ชั้นล่างโล่ง) ไม่ใช่รุ่น 108ล/30 ของจริง จึงยังไม่ปรับรูปทรงตามนั้น' },
  F: { name: 'อาคาร 2 (แบบ 108ล แถวกลาง)', kind: 'อาคารเรียน 2 ชั้น', src: 'site', facts: [['ห้องน้ำครู', 'หัว/ท้ายอาคาร ที่ชั้นบันไดขึ้นชั้น 2'], ['ห้องพยาบาล', 'อยู่กลางอาคาร'],['ปีที่สร้าง', 'พ.ศ. 2534 หรือ 2539'], ['ห้องเรียน', 'ตามแบบ 8 ห้อง'], ['งบประมาณ', '4,957,000 บาท']], note: 'มีหลังคาทางเดินสีฟ้าด้านทิศใต้ ปีที่สร้างระบุได้แค่ว่าเป็นหนึ่งในสองหลังของแบบ 108ล' },
  C: { name: 'หอประชุม', kind: 'อาคารชั้นเดียว ขนาดใหญ่', src: 'site', facts: [['แบบมาตรฐาน', 'อาคารหอประชุม 100/27 (กรมสามัญศึกษา ปรับปรุง 2530)'], ['ปีที่สร้าง', 'พ.ศ. 2545 · งบ 3,816,000 บาท · สภาพพอใช้'], ['ขนาดตามแบบ', 'ราว 42 × 26 ม. + ทางเดิน คสล. กว้าง 2 ม. สองด้านยาว'], ['ในแบบ', 'พื้นที่แข่งบาสเกตบอลมาตรฐาน · เวทียกพื้น · ห้องเก็บของ · ล็อกเกอร์ชาย/หญิงหัว-ท้ายอาคาร'], ['หลังคา', '2 ชั้น มีช่องระบายอากาศบนสัน'], ['ผนัง', 'ช่วงล่างสีน้ำตาลแดง ช่วงบนสีขาว']], note: 'รูปทรงจากภาพหอประชุมบนเว็บไซต์โรงเรียน ตำแหน่งประเมินจากรูปทรงหลังคาในภาพดาวเทียม · แบบ ขนาด และห้องภายในเทียบกับแบบรูปรายการ สพฐ. ปีงบ 2562 (ทางเดินสองข้างตรงกับหลังคาเพิงด้านเหนือ/ใต้)', rect: [502,462,632,560] },
  D: { name: 'โดมอเนกประสงค์ (สนามฟุตซอล)', kind: 'สนามฟุตซอลในร่ม หลังคาโค้ง', src: 'site', facts: [['การใช้งาน', 'แข่งฟุตซอล จัดกิจกรรมและเรียนพลศึกษา'], ['ภายใน', 'สนามฟุตซอล มีพระพุทธรูปประดิษฐานด้านข้าง']], note: 'ข้อมูลและภาพภายในจากเว็บไซต์โรงเรียน' },
  courts: { name: 'สนามบาสเกตบอล', kind: 'ลานคอนกรีต พื้นสีฟ้า เขตโทษสีส้ม', src: 'site', facts: [['ขนาดสนาม', '28 × 15 ม.']], note: 'ภาพมุมสูงบนเว็บไซต์โรงเรียน ตำแหน่งจากภาพดาวเทียมและตามที่ผู้ใช้ระบุ', rect: [COURT_BX, 380, COURT_BX + 92, 440], swatch: '#2f78bf', label: 'สนามบาส' },
  courts2: { name: 'สนามวอลเลย์บอลและตะกร้อ', kind: 'ลานคอนกรีต 3 สนาม', src: 'site', facts: [['วอลเลย์บอล', '1 สนาม 9 × 18 ม.'], ['ตะกร้อ', '2 สนามต่อกัน 6.1 × 13.4 ม. ต่อสนาม']], note: 'ตำแหน่งและจำนวนสนามตามที่ผู้ใช้ระบุ ขนาดตามมาตรฐานสนามแข่ง', rect: [520, 380, 612, 440], swatch: '#e0823a', label: 'ตะกร้อ · วอลเลย์' },
  beach: { name: 'สนามวอลเลย์บอลชายหาด', kind: 'ลานทราย ท้ายลู่วิ่ง ใกล้สระน้ำ', src: 'site', facts: [['ขนาดสนาม', '16 × 8 ม.']], note: 'ลานทรายสีเทาอ่อนท้ายสนามฟุตบอล ตามที่ผู้ใช้ระบุ (เดิมระบุว่าเป็นบ่อทรายกระโดดไกล)', rect: [200, 724, 262, 750], swatch: '#dccb9e', label: 'วอลเลย์ชายหาด' },
  petanque: { name: 'สนามเปตอง', kind: '4 สนาม พื้นลูกรัง', src: 'site', facts: [['ขนาดสนาม', '12 × 3 ม. ต่อสนาม']], note: 'ตำแหน่งและจำนวนสนามตามที่ผู้ใช้ระบุ ขนาด 12 × 3 ม. เป็นค่าประมาณ', rect: [434, 299, 510, 323], swatch: '#cdb98a', label: 'เปตอง' },
  track: { name: 'สนามฟุตบอลและลู่วิ่ง', kind: 'สนามหญ้า', src: 'sat', facts: [['ลู่วิ่ง', 'วงรีราว 73 × 161 ม. ใกล้เคียงลู่ 400 เมตร'], ['อื่น ๆ', 'สนามวอลเลย์บอลชายหาดด้านทิศใต้']], note: 'วัดจากภาพดาวเทียม', rect: [102,318,320,789], swatch: '#86aa58', label: 'สนามฟุตบอล' },
  houses: { name: 'บ้านพักครูและบ้านพัก', kind: 'บ้าน 2 ชั้นใต้ถุนสูง', src: 'site', facts: [['ตามข้อมูลโรงเรียน', 'บ้านพักครูแบบ 205/26 (2540), 203/27 (2540), 207 (2545) และบ้านพักนักเรียน'], ['ในภาพดาวเทียม', 'อาคารขนาดเล็กราว 10 หลังแถวทิศใต้']], note: 'รูปแบบบ้านจากภาพบนเว็บไซต์ ผนังสีส้มอมชมพู ตำแหน่งแต่ละหลังยังจับคู่กับชื่อไม่ได้', rect: [461,894,753,1003], swatch: '#e8896b', label: 'บ้านพักครู' },
  tower: { name: 'หอส่งน้ำประปาโรงเรียน', kind: 'หอถังน้ำทรงกลม', src: 'site', facts: [['ปีที่สร้าง', 'พ.ศ. 2547'], ['งบประมาณ', '101,000 บาท']], note: 'รูปทรงจากภาพบนเว็บไซต์ ตำแหน่งเป็นค่าประมาณจากภาพมุมสูง', rect: [347,737,357,747], swatch: '#e8b62c' },
  gate: { name: 'ซุ้มประตู ป้ายโรงเรียน และรั้ว', kind: 'ทางเข้าด้านถนนสายหลัก', src: 'site', facts: [['รั้วคอนกรีต', 'สร้างปี 2555 งบประมาณ 2,000,000 บาท'], ['ป้าย', 'กรอบไม้สีน้ำตาล พื้นสีเทาฟ้า อักษรสีทอง']], note: 'ลักษณะป้ายและรั้วจากภาพบนเว็บไซต์ ตำแหน่งป้ายเป็นค่าประมาณ', rect: [300,205,382,262], swatch: '#e7b92c', label: 'ทางเข้า' },
  pond: { name: 'บ่อน้ำและศาลากลางน้ำ', kind: 'บ่อน้ำ มีศาลากลางน้ำตรงกลาง', src: 'site', facts: [['ศาลากลางน้ำ', 'อยู่กึ่งกลางบ่อ หลังคาสีน้ำเงิน มีสะพานไม้เชื่อมฝั่งตะวันออก'], ['ขนาดบ่อ', 'ราว 57 × 48 ม.']], note: 'เห็นจากภาพดาวเทียม ยังไม่ทราบชื่อหรือการใช้งาน · ศาลากลางน้ำอยู่กึ่งกลางบ่อ มีสะพานไม้เชื่อมฝั่งตะวันออก (ผู้ใช้ระบุ)', rect: [155,857,320,995], swatch: '#35584b', label: 'บ่อน้ำ · ศาลากลางน้ำ' },
  B: { name: 'อาคารนาฏศิลป์ · ดนตรี', kind: 'อาคารชั้นเดียว หลังคาสีฟ้า หน้าสนามวอลเลย์บอล', src: 'site', facts: [['การใช้งาน', 'นาฏศิลป์ และดนตรี']], note: 'ชื่อและการใช้งานตามที่ผู้ใช้ระบุ ตำแหน่งและขนาดวัดจากภาพดาวเทียม' },
  farm: { name: 'แปลงเกษตร', kind: 'แปลงผัก ข้างสระน้ำ', src: 'site', facts: [], note: 'ตำแหน่งตามที่ผู้ใช้วงไว้บนแผนที่ ลายร่องเป็นภาพประกอบ ไม่ใช่จำนวนแปลงจริง', rect: FARM, swatch: '#62973f', label: 'แปลงเกษตร' },
  T2: { name: 'ห้องน้ำ นร.หญิง', kind: 'ห้องน้ำนักเรียนหญิง หลังคาสีน้ำเงิน ฝั่งตะวันออก', src: 'site', facts: [['ใช้โดย', 'นักเรียนหญิง']], note: 'การใช้งานตามที่ผู้ใช้ระบุ ตำแหน่งและขนาดวัดจากภาพดาวเทียม' },
  T3: { name: 'ห้องน้ำ นร.ชาย', kind: 'ห้องน้ำนักเรียนชาย ข้างโรงอาหาร', src: 'site', facts: [['ใช้โดย', 'นักเรียนชาย']], note: 'ตำแหน่งและการใช้งานตามที่ผู้ใช้ระบุ' },
  W1: { name: 'ศาลาอินทนิล', kind: 'ศาลา เปิดโล่งไม่มีผนัง พื้นยกสูงปูกระเบื้องสีน้ำเงิน หลังคาสีแดง หน้าสนามฟุตบอล', src: 'site', facts: [['การใช้งาน', 'จัดพิธีเปิดงาน']], note: 'ชื่อและการใช้งานตามที่ผู้ใช้ระบุ ตำแหน่งและขนาดวัดจากภาพดาวเทียม' },
  S1: { name: 'ห้องน้ำ นร.หญิง (ใหม่)', kind: 'ห้องน้ำนักเรียนหญิง หลังคาปั้นหยา ฝั่งตะวันออก ใต้โรงเรียน', src: 'site', facts: [['แบบ', 'ส้วม 4 ที่/49 (สพฐ.)'], ['ปีที่สร้าง', 'พ.ศ. 2563 หรือ 2568 (สองหลังนี้สร้างคนละปี)'], ['ขนาดตามแบบ', 'ราว 5 × 3 ม.']], note: 'ยังไม่ยืนยันว่าหลังไหนชาย/หญิง (ผู้ใช้ให้ใส่ไว้ก่อน) · ตำแหน่งตามดาวแดงที่ผู้ใช้ทำเครื่องหมาย เว็บ รร ลงส้วม 4 ที่/49 สองหลัง (ปี 2563 งบ 387,800 · ปี 2568 งบ 397,200) ยังไม่ทราบว่าหลังไหนสร้างปีใด' },
  S2: { name: 'ห้องน้ำ นร.ชาย (ใหม่)', kind: 'ห้องน้ำนักเรียนชาย หลังคาปั้นหยา ฝั่งตะวันออก ใต้โรงเรียน', src: 'site', facts: [['แบบ', 'ส้วม 4 ที่/49 (สพฐ.)'], ['ปีที่สร้าง', 'พ.ศ. 2563 หรือ 2568 (สองหลังนี้สร้างคนละปี)'], ['ขนาดตามแบบ', 'ราว 5 × 3 ม.']], note: 'ยังไม่ยืนยันว่าหลังไหนชาย/หญิง (ผู้ใช้ให้ใส่ไว้ก่อน) · ตำแหน่งตามดาวแดงที่ผู้ใช้ทำเครื่องหมาย เว็บ รร ลงส้วม 4 ที่/49 สองหลัง (ปี 2563 งบ 387,800 · ปี 2568 งบ 397,200) ยังไม่ทราบว่าหลังไหนสร้างปีใด' },
  W2: { name: 'โรงน้ำ', kind: 'อาคารหลังคาสีน้ำเงิน ข้างถนนภายใน ใกล้อาคาร 2–3', src: 'site', facts: [], note: 'ชื่อตามที่ผู้ใช้ระบุ ตำแหน่งและขนาดวัดจากภาพดาวเทียม · หอส่งน้ำ (เสาน้ำประปา) อยู่ด้านหลังอาคาร ทางตะวันตก' },
  W3: { name: 'ตู้กดน้ำ', kind: 'ตู้กดน้ำดื่ม หลังคาสีฟ้าอ่อน', src: 'site', facts: [], note: 'ชื่อตามที่ผู้ใช้ระบุ ตำแหน่งและขนาดวัดจากภาพดาวเทียม' },
  W5: { name: 'คาเฟ่เฮือนกาแฟ', kind: 'ร้านกาแฟ หลังคาสีน้ำเงิน ข้างแปลงเกษตร', src: 'site', facts: [], note: 'ชื่อตามที่ผู้ใช้ระบุ ตำแหน่งและขนาดวัดจากภาพดาวเทียม' },
  P1: { name: 'ศาลาข้างสนามบาส', kind: 'ศาลา ไม่มีชื่อ ทิศใต้ของสนามบาส ตรงข้ามโดมโดยมีถนนคั่น', src: 'site', facts: [['การใช้งาน', 'นักบาสรวมกลุ่มกัน']], note: 'ตำแหน่งตามที่ผู้ใช้บอก (ติดโดม มีถนนคั่น) ขนาดและรูปทรงเป็นค่าประมาณ ยังไม่ได้ดูภาพดาวเทียมละเอียด' },
  V1: { name: 'ตู้กดน้ำกระป๋อง (Sundew)', kind: 'ตู้หยอดเหรียญ ทางซ้ายของศาลาสนามบาส', src: 'site', facts: [['ชนิด', 'ตู้กดน้ำกระป๋อง หยอดเหรียญ ยี่ห้อ Sundew']], note: 'ตำแหน่งตามที่ผู้ใช้บอก ขนาดเป็นค่าประมาณ' },
  I2: { name: 'โดมสนามมวย', kind: 'โดมเปิดโล่ง หลังคาโค้งสีเทา ไม่มีผนัง', src: 'site', facts: [['ภายใน', 'เวทีมวยตรงกลาง']], note: 'ชื่อและลักษณะตามที่ผู้ใช้บอก ตำแหน่งและขนาดวัดจากภาพดาวเทียม ขนาดเวทีเป็นค่าประมาณ' },
  stands: { name: 'สแตนเชียร์สี 4 สี และป้ายใหญ่', kind: 'สแตนเชียร์ริมสนามฟุตบอลด้านตะวันตก', src: 'site', facts: [['จำนวน', '4 สแตนด์ (ส้ม เขียว น้ำเงิน ชมพู)'], ['ป้ายใหญ่', 'กลางแนวสแตน']], note: 'ตามภาพถ่ายงานกีฬาสีที่ผู้ใช้ส่งมา ตำแหน่งตามแนวภาพ ลำดับสีและระยะห่างเป็นค่าประมาณ', rect: [90,440,106,642], swatch: '#3aa05a', label: 'สแตนเชียร์สี' },
  K3: { name: 'ซุ้มร้านน้ำ Sundew', kind: 'ซุ้มขายน้ำ หลังคาทรงไทยสีขาว แถบเขียว–แดง', src: 'site', facts: [['ร้าน', 'น้ำ Sundew']], note: 'ตำแหน่งประมาณจากคำบอก (แถวต้นไม้ใหญ่ ทางตะวันออกของอาคารนาฏศิลป์) ขนาดประมาณ 3 ม.' },
  M1: { name: 'ที่จอดรถมอเตอร์ไซค์', kind: 'โรงจอดรถ แถวยาวแนวเหนือ–ใต้ ข้างอาคาร 4 ฝั่งตะวันออก', src: 'site', facts: [['ขนาดโดยประมาณ', 'ราว 41 × 7 ม.']], note: 'ชื่อและตำแหน่งตามที่ผู้ใช้ระบุ (ทำเครื่องหมายบนภาพ) ขนาดวัดจากภาพดาวเทียม' },
  L1: { name: 'โรงรถครู', kind: 'โรงจอดรถ แถวยาว ระหว่างอาคาร 3 กับบ้านพักครู', src: 'site', facts: [], note: 'ชื่ออาคารตามที่ผู้ใช้ระบุ ตำแหน่งและขนาดวัดจากภาพดาวเทียม' },
  H: { name: 'โรงอาหาร', kind: 'โดมขนาดใหญ่ เปิดโล่งไม่มีผนัง หลังคาเหล็กสีเทา', src: 'site', facts: [['ท้ายโดม', 'ร้านค้าเรียงกัน'], ['ด้านใน', 'โต๊ะโรงอาหาร']], note: 'ลักษณะตามที่ผู้ใช้บอก ตำแหน่งและขนาดวัดจากภาพดาวเทียม · ร้านค้าวางไว้ที่ปลายด้านใต้ (ติดห้องน้ำ นร.ชาย) และจำนวนร้าน/โต๊ะเป็นค่าประมาณ' },
};
const ORDER = ['A','G','E','F','C','D','courts','courts2','petanque','beach','track','T3','T2','P1','V1','K3','I2','stands','W2','W3','W5','W1','L1','houses','farm','gate','tower','pond','B','H'];

/* (โหมดงานกีฬา MODES ของต้นฉบับไม่ได้ใช้ในแอปนี้) */

/* ---------- facade textures ---------- */
const PPM = 36;
const facadeCache = new Map();
function win(g, x, y, w, h, glass, mull){
  g.fillStyle = glass; g.fillRect(x, y, w, h);
  const gr = g.createLinearGradient(x, y, x + w, y + h); gr.addColorStop(0, 'rgba(255,255,255,.22)'); gr.addColorStop(.55, 'rgba(255,255,255,.02)'); gr.addColorStop(1, 'rgba(255,255,255,.14)');
  g.fillStyle = gr; g.fillRect(x, y, w, h);
  g.strokeStyle = 'rgba(236,236,230,.9)'; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, w - 2, h - 2);
  if (mull){ const n = Math.max(2, Math.round(w / (PPM * 0.8))); g.beginPath(); for (let i = 1; i < n; i++){ const xx = x + w * i / n; g.moveTo(xx, y); g.lineTo(xx, y + h); } g.moveTo(x, y + h * 0.62); g.lineTo(x + w, y + h * 0.62); g.stroke(); }
}
function breeze(g, x0, x1, y, h, wall){
  g.fillStyle = lt(wall, .18); g.fillRect(x0, y, x1 - x0, h);
  const s = Math.max(6, Math.round(PPM * 0.2)); g.fillStyle = dk(wall, .6);
  for (let yy = y + 3; yy < y + h - s * 0.6; yy += s) for (let xx = x0 + 3; xx < x1 - s * 0.6; xx += s) g.fillRect(xx, yy, s * 0.55, s * 0.55);
}
function facade(o){
  const key = JSON.stringify(o); if (facadeCache.has(key)) return facadeCache.get(key);
  const H = o.base + o.floors * o.fh, cw = Math.max(8, Math.round(o.bay * PPM)), ch = Math.max(8, Math.round(H * PPM));
  const c = document.createElement('canvas'); c.width = cw; c.height = ch; const g = c.getContext('2d');
  const Y = mm => ch - mm * PPM, M = mm => mm * PPM, end = o.face === 'end';
  g.fillStyle = o.wall; g.fillRect(0, 0, cw, ch);
  const gr = g.createLinearGradient(0, 0, 0, ch); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(70,45,25,.13)'); g.fillStyle = gr; g.fillRect(0, 0, cw, ch);
  g.fillStyle = dk(o.trim, .25); g.fillRect(0, Y(o.base), cw, M(o.base));
  if (o.style === 'hall'){
    g.fillStyle = o.trim; g.fillRect(0, Y(o.base + 1.3), cw, M(1.3));
    if (!end){
      const x0 = M(0.55), w = cw - M(1.1), y1 = o.base + 1.5, y2 = o.base + 4.7;
      g.fillStyle = '#2f3337'; g.fillRect(x0, Y(y2), w, M(y2 - y1));
      g.fillStyle = lt(o.wall, .1); for (let x = x0 + 4; x < x0 + w; x += M(0.2)) g.fillRect(x, Y(y2), 2, M(y2 - y1));
      g.fillStyle = '#3a3f44'; g.fillRect(x0, Y(o.base + 6.3), w, M(0.6));
      g.fillStyle = o.col; g.fillRect(0, 0, M(0.14), ch); g.fillRect(cw - M(0.14), 0, M(0.14), ch);
    } else {
      g.fillStyle = dk(o.trim, .3); g.fillRect(cw / 2 - M(1.7), Y(o.base + 3.2), M(3.4), M(3.2));
      g.fillStyle = '#3a3f44'; for (let i = 0; i < 6; i++) g.fillRect(cw * (0.1 + 0.14 * i), Y(o.base + 6), M(1.1), M(0.5));
    }
  } else if (o.style === 'hall2'){
    g.fillStyle = '#2e3236'; g.fillRect(0, Y(o.base + o.fh - 0.3), cw, M(1.5));
    if (!end){ g.fillStyle = dk(o.wall, .4); g.fillRect(M(1), Y(o.base + 2.7), M(1.6), M(2.7)); g.fillStyle = o.col; g.fillRect(0, 0, M(0.1), ch); g.fillRect(cw - M(0.1), 0, M(0.1), ch); }
  } else if (o.style === 'toilet'){
    breeze(g, 0, cw, Y(o.base + o.fh - 0.25), M(0.85), o.wall);
    if (!end){ g.fillStyle = dk(o.trim, .25); g.fillRect(M(0.6), Y(o.base + 1.9), M(0.8), M(1.9)); }
  } else {
    for (let f = 0; f < o.floors; f++){
      const y0 = o.base + f * o.fh, top = y0 + o.fh, open = f === 0 && o.pilotis;
      if (open){
        g.fillStyle = dk(o.wall, .62); g.fillRect(0, Y(top - 0.3), cw, M(o.fh - 0.3));
        g.fillStyle = dk(o.wall, .45); g.fillRect(M(0.7), Y(y0 + (o.style === 'house' ? 1.6 : 2.5)), cw - M(1.4), M(o.style === 'house' ? 1.6 : 1.5));
      } else if (end){
        win(g, cw / 2 - M(0.5), Y(y0 + 2.3), M(1.0), M(1.3), o.glass, false);
      } else if (o.face === 'cor'){
        g.fillStyle = o.recess ? dk(o.recess, .15) : dk(o.wall, .58); g.fillRect(0, Y(top - 0.3), cw, M(o.fh - 0.3));
        g.fillStyle = o.recess || dk(o.wall, .4); g.fillRect(0, Y(top - 0.75), cw, M(o.fh - 0.75));
        g.fillStyle = dk(o.trim, .3); g.fillRect(M(0.5), Y(y0 + 2.1), M(0.9), M(2.1));
        g.fillStyle = dk(o.glass, .15); g.fillRect(M(1.8), Y(y0 + 2.25), cw - M(2.3), M(1.2));
        if (f > 0) { breeze(g, 0, cw, Y(y0 + 1.05), M(1.05), o.wall); g.fillStyle = o.trim; g.fillRect(0, Y(y0 + 1.05), cw, 3); }
      } else {
        const wh = o.style === 'house' ? 1.2 : Math.min(1.75, o.fh - 1.5), wy = y0 + 0.9;
        win(g, M(0.45), Y(wy + wh), cw - M(0.9), M(wh), o.glass, true);
        g.fillStyle = lt(o.wall, .3); g.fillRect(M(0.35), Y(wy), cw - M(0.7), M(0.08));
      }
      g.fillStyle = o.trim; g.fillRect(0, Y(top), cw, M(0.32));
    }
    const colW = M((o.face === 'cor' || o.pilotis) ? 0.42 : 0.26);
    g.fillStyle = o.col;
    if (!end){ g.fillRect(0, 0, colW / 2, ch); g.fillRect(cw - colW / 2, 0, colW / 2, ch); }
    else if (o.pilotis){ const t = Y(o.base + o.fh); [0, cw / 2 - colW / 2, cw - colW].forEach(x => g.fillRect(x, t, colW, M(o.fh))); }
  }
  facadeCache.set(key, c); return c;
}

/* corrugated metal (grey, tinted by material colour) */
const ribTex = (() => { const c = document.createElement('canvas'); c.width = 64; c.height = 4; const g = c.getContext('2d'); g.fillStyle = '#e8e8e8'; g.fillRect(0, 0, 64, 4); for (let i = 0; i < 4; i++){ g.fillStyle = '#b9b9b9'; g.fillRect(i * 16, 0, 3, 4); g.fillStyle = '#ffffff'; g.fillRect(i * 16 + 3, 0, 2, 4); } return canvasTex(c); })();

/* ---------- roof geometry (local: long axis = x, eave at y = 0) ---------- */
function geomFrom(pos, uv){ const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals(); return g; }
function roofGeom(type, L, D, r){
  const hx = L / 2, hz = D / 2, rx = type === 'hip' ? Math.max(0, hx - hz) : hx;
  const A = [-hx,0,-hz], B = [hx,0,-hz], C = [hx,0,hz], Dd = [-hx,0,hz], R1 = [-rx,r,0], R2 = [rx,r,0];
  const pos = [], uv = [];
  const tri = (a, b, c, alongX) => { for (const p of [a, b, c]){ pos.push(...p); uv.push(alongX ? p[0] * 0.55 : p[2] * 0.55, alongX ? p[2] : p[0]); } };
  tri(A, R1, R2, true); tri(A, R2, B, true);
  tri(C, R2, R1, true); tri(C, R1, Dd, true);
  if (type === 'hip'){ tri(A, Dd, R1, false); tri(C, B, R2, false); }
  return geomFrom(pos, uv);
}
function gableEnds(bl, bd, drop, r){
  const pos = [], uv = [];
  for (const s of [-1, 1]){
    const x = s * bl / 2, a = [x, drop, -bd / 2], b = [x, drop, bd / 2], c = [x, r, 0];
    const pts = s < 0 ? [a, b, c] : [b, a, c];
    for (const p of pts){ pos.push(...p); uv.push(p[2], p[1]); }
  }
  return geomFrom(pos, uv);
}
function archGeom(L, D, r, seg = 18){
  const hx = L / 2, hz = D / 2, pos = [], uv = [], idx = [];
  for (let i = 0; i <= seg; i++){ const t = i / seg, z = -hz + D * t, y = r * (1 - (z / hz) ** 2); pos.push(-hx, y, z, hx, y, z); uv.push(-hx * 0.55, t * D, hx * 0.55, t * D); }
  for (let i = 0; i < seg; i++){ const a = i * 2, b = a + 1, c = a + 2, d = a + 3; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
function shedGeom(L, D, hiZ, hi, lo){ // hiZ = -1: high edge at -z
  const hx = L / 2, hz = D / 2, yN = hiZ < 0 ? hi : lo, yS = hiZ < 0 ? lo : hi;
  const A = [-hx,yN,-hz], B = [hx,yN,-hz], C = [hx,yS,hz], Dd = [-hx,yS,hz], pos = [], uv = [];
  for (const p of [A, Dd, C, A, C, B]){ pos.push(...p); uv.push(p[0] * 0.55, p[2]); }
  return geomFrom(pos, uv);
}

/* ---------- building builder ---------- */
const REG = {};           // id -> { mats, center, size, top, swatch }
const pickables = [];
const matWall = (hex) => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.9 });
function reg(id){ return REG[id] || (REG[id] = { mats: [], meshes: [], boxes: [] }); }

function building(d){
  const [x0, y0, x1, y1] = d.rect;
  let L = (x1 - x0) * S, D = (y1 - y0) * S;
  const alongX = d.axis ? d.axis === 'x' : L >= D;
  if (!alongX) [L, D] = [D, L];
  const grp = new THREE.Group(); grp.name = d.id;
  grp.position.set(wx((x0 + x1) / 2), 0, wz((y0 + y1) / 2));
  if (!alongX) grp.rotation.y = -Math.PI / 2;
  const R = reg(d.part || d.id);
  const ov = d.ov ?? 1.0, bl = Math.max(1.5, L - 2 * ov), bd = Math.max(1.5, D - 2 * ov);
  const floors = d.floors ?? 1, fh = d.fh ?? 3.4, base = d.base ?? 0.45;
  const H = base + floors * fh;
  const wall = d.wall || '#efece4', trim = d.trim || '#8d8a82';
  let top = H;

  if (!d.open){
    const map = alongX ? { s: 1, n: -1 } : { w: 1, e: -1 };
    const corZ = d.cor ? map[d.cor] : 0;
    const style = d.style || 'school', bay = d.bay || 4;
    const faceMat = (face, width, wl) => {
      const b = face === 'end' ? width : bay;
      const cnv = facade({ face, style, floors, fh, base, bay: +b.toFixed(2), wall: wl || wall, trim, glass: d.glass || '#4b5c6e', col: d.col || trim, pilotis: !!d.pilotis, recess: d.recess });
      const t = canvasTex(cnv); t.repeat.set(face === 'end' ? 1 : Math.max(1, Math.round(width / bay)), 1);
      const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.88 }); R.mats.push(m); return m;
    };
    const pz = faceMat(corZ === 1 ? 'cor' : 'win', bl), nz = faceMat(corZ === -1 ? 'cor' : 'win', bl);
    const e1 = faceMat('end', bd), e2 = faceMat('end', bd, d.endWallW);
    const capM = matWall(wall); R.mats.push(capM);
    if (d.openGround){
      // ใต้ถุนโล่งจริง (ผู้ใช้สั่ง 22 พ.ย.): ตัวอาคารเริ่มที่พื้นชั้น 2 · เสา + แผ่นพื้น · ห้องกระจกที่หัวอาคารด้านตะวันตก (ห้องฟิตเนส)
      const fm2 = (face, width, wl) => { const b2 = face === 'end' ? width : bay;
        const cnv = facade({ face, style, floors: floors - 1, fh, base: 0, bay: +b2.toFixed(2), wall: wl || wall, trim, glass: d.glass || '#4b5c6e', col: d.col || trim, pilotis: false, recess: d.recess });
        const t = canvasTex(cnv); t.repeat.set(face === 'end' ? 1 : Math.max(1, Math.round(width / bay)), 1);
        const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.88 }); R.mats.push(m); return m; };
      const hu = (floors - 1) * fh, y2 = base + fh;
      const u1 = fm2('end', bd), u2 = fm2('end', bd, d.endWallW), upz = fm2(corZ === 1 ? 'cor' : 'win', bl), unz = fm2(corZ === -1 ? 'cor' : 'win', bl);
      const upper = new THREE.Mesh(new THREE.BoxGeometry(bl, hu, bd), [u1, u2, capM, capM, upz, unz]);
      upper.position.y = y2 + hu / 2; upper.castShadow = upper.receiveShadow = true; grp.add(upper);
      const slabM = matWall('#cfcdc6'); R.mats.push(slabM);
      const slab = new THREE.Mesh(new THREE.BoxGeometry(bl, 0.3, bd), slabM); slab.position.y = y2 - 0.15; slab.castShadow = slab.receiveShadow = true; grp.add(slab);
      const colM = matWall(d.col || '#e8e6df'); R.mats.push(colM);
      const colSp = d.colBay || 4, nCol = Math.round(bl / colSp);
      for (let i = 0; i <= nCol; i++) [-1, 1].forEach(sz => { const c = new THREE.Mesh(new THREE.BoxGeometry(0.45, y2 - 0.3 - base, 0.45), colM); c.position.set(-bl / 2 + 0.25 + i * (bl - 0.5) / nCol, base + (y2 - 0.3 - base) / 2, sz * (bd / 2 - 0.3)); c.castShadow = true; grp.add(c); });
      const gl = d.fitness;   // { w: ความกว้าง ม., end: -1 ตะวันตก / 1 ตะวันออก }
      if (gl){
        const gm = new THREE.MeshStandardMaterial({ color: '#9fd6e6', roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.35, side: THREE.DoubleSide }); R.mats.push(gm);
        const fr = matWall('#3a3f44'); R.mats.push(fr);
        const gx = gl.end * (bl / 2 - gl.w / 2 - 0.25), gh = y2 - 0.3 - base;
        const bw = (w, h2, dd, x, y, z, m) => { const q = new THREE.Mesh(new THREE.BoxGeometry(w, h2, dd), m); q.position.set(x, y, z); grp.add(q); return q; };
        bw(gl.w, 0.1, bd - 0.5, gx, base + 0.05, 0, matWall('#b9b4a6'));
        bw(gl.w, gh, 0.06, gx, base + gh / 2, bd / 2 - 0.3, gm); bw(gl.w, gh, 0.06, gx, base + gh / 2, -(bd / 2 - 0.3), gm);
        bw(0.06, gh, bd - 0.5, gx + gl.w / 2, base + gh / 2, 0, gm); bw(0.06, gh, bd - 0.5, gx - gl.w / 2, base + gh / 2, 0, gm);
        for (let k = 0; k <= 4; k++) [-1, 1].forEach(sz => bw(0.07, gh, 0.08, gx - gl.w / 2 + k * gl.w / 4, base + gh / 2, sz * (bd / 2 - 0.3), fr));
        bw(gl.w, 0.08, bd - 0.5, gx, y2 - 0.35, 0, fr);
        const eq = matWall('#2b2f33');
        for (let k = 0; k < 4; k++) bw(1.8, 1.3, 0.8, gx - gl.w / 2 + 1.6 + k * 1.9, base + 0.75, -bd / 2 + 1.6, eq);
        for (let k = 0; k < 3; k++) bw(0.8, 0.5, 1.8, gx - gl.w / 2 + 1.6 + k * 2.2, base + 0.35, bd / 2 - 2.2, eq);
      }
    } else {
    const box = new THREE.Mesh(new THREE.BoxGeometry(bl, H, bd), [e1, e2, capM, capM, pz, nz]);
    box.position.y = H / 2; box.castShadow = box.receiveShadow = true; grp.add(box);
    }
    // กันสาดเหล็กลูกฟูกลาดเอียงด้านทางเดินที่ระดับพื้นชั้น 2 และ 3 (ตามภาพถ่ายอาคาร 3)
    if (d.awnings && corZ){
      const am = new THREE.MeshStandardMaterial({ color: d.awnColor || '#8f8c84', roughness: 0.6, metalness: 0.2 }); R.mats.push(am);
      for (let k = 1; k < floors; k++){ const aw = new THREE.Mesh(new THREE.BoxGeometry(bl, 0.08, 1.7), am); aw.position.set(0, base + fh * k + 0.15, corZ * (bd / 2 + 0.75)); aw.rotation.x = corZ * 0.22; aw.castShadow = true; grp.add(aw); }
    }
    // กันสาดชั้นล่างด้านหลังอาคาร (ฝั่งตรงข้ามทางเดิน) เตี้ย สีครีม — ตามภาพจริงอาคาร 1 ด้านหลัง
    if (d.awnBack && corZ){
      const bm = new THREE.MeshStandardMaterial({ color: d.awnBack, roughness: 0.7, metalness: 0.1 }); R.mats.push(bm);
      const aw = new THREE.Mesh(new THREE.BoxGeometry(bl, 0.08, 2.0), bm); aw.position.set(0, base + 2.7, -corZ * (bd / 2 + 0.9)); aw.rotation.x = -corZ * 0.2; aw.castShadow = true; grp.add(aw);
    }
    // โถงบันได 2 จุด ยื่นออกด้านทางเดิน (ตามแบบ 216ล: แกน 4–5 และ 17–18 ยื่นออก 3.6 ม.)
    if (d.towers && corZ){
      const tw = d.towers, th = H + 0.35;
      const tf = (bayW) => { const cnv = facade({ face: 'end', style, floors, fh, base, bay: +bayW.toFixed(2), wall, trim, glass: d.glass || '#4b5c6e', col: d.col || trim, pilotis: false });
        const t = canvasTex(cnv); t.repeat.set(1, 1); const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.88 }); R.mats.push(m); return m; };
      const roofT = new THREE.MeshStandardMaterial({ color: d.roof || '#8a8f94', roughness: 0.6, metalness: 0.1 }); R.mats.push(roofT);
      const capT = matWall(wall); R.mats.push(capT);
      [-1, 1].forEach(sx => {
        if (tw.low){   // ชายคาโถงบันไดชั้นเดียว หลังคาแบน เสา 2 ต้น (ตามภาพถ่ายอาคาร 4)
          const lx = sx * (bl / 2 - tw.off), lz = corZ * (bd / 2 + tw.dep / 2 - 0.1), lh = base + fh;
          const ls = new THREE.Mesh(new THREE.BoxGeometry(tw.w + 0.6, 0.28, tw.dep + 0.6), capT); ls.position.set(lx, lh + 0.14, lz); ls.castShadow = true; grp.add(ls);
          const lt = new THREE.Mesh(new THREE.BoxGeometry(tw.w + 0.7, 0.14, tw.dep + 0.7), roofT); lt.position.set(lx, lh + 0.35, lz); grp.add(lt);
          for (const dx of [-1, 1]){ const lp = new THREE.Mesh(new THREE.BoxGeometry(0.4, lh, 0.4), new THREE.MeshStandardMaterial({ color: d.col || trim, roughness: 0.8 })); lp.position.set(lx + dx * (tw.w / 2 - 0.3), lh / 2, lz + corZ * (tw.dep / 2 - 0.3)); grp.add(lp); }
          return;
        }
        const cx = sx * (bl / 2 - tw.off), cz = corZ * (bd / 2 + tw.dep / 2 - 0.1);
        const side = tf(tw.dep), front = tf(tw.w);
        const tb = new THREE.Mesh(new THREE.BoxGeometry(tw.w, th, tw.dep), corZ === 1 ? [side, side, capT, capT, front, capT] : [side, side, capT, capT, capT, front]);
        tb.position.set(cx, th / 2, cz); tb.castShadow = tb.receiveShadow = true; grp.add(tb);
        const slab = new THREE.Mesh(new THREE.BoxGeometry(tw.w + 0.7, 0.22, tw.dep + 0.7), roofT); slab.position.set(cx, th + 0.11, cz); slab.castShadow = true; grp.add(slab);
        if (!tw.flat) { const pyr = new THREE.Mesh(new THREE.ConeGeometry(Math.SQRT1_2, 1.5, 4), roofT); pyr.rotation.y = Math.PI / 4; pyr.scale.set(tw.w + 0.7, 1, tw.dep + 0.7); pyr.position.set(cx, th + 0.22 + 0.75, cz); pyr.castShadow = true; grp.add(pyr); }
      });
    }
  }

  const roofM = new THREE.MeshStandardMaterial({ color: d.roof || '#8a8f94', map: ribTex, roughness: 0.55, metalness: 0.15, side: THREE.DoubleSide });
  R.mats.push(roofM);
  const type = d.roofType || 'gable';
  if (type === 'gable' || type === 'hip'){
    const rise = (D / 2) * Math.tan((d.pitch ?? 24) * Math.PI / 180), drop = rise * ov / (D / 2);
    const roof = new THREE.Mesh(roofGeom(type, L, D, rise), roofM); roof.position.y = H - drop; roof.castShadow = roof.receiveShadow = true; grp.add(roof);
    if (type === 'gable' && !d.open){ const gm = matWall(wall); R.mats.push(gm); const ends = new THREE.Mesh(gableEnds(bl, bd, drop, rise), gm); ends.position.y = H - drop; ends.castShadow = true; grp.add(ends); }
    const fasc = new THREE.MeshStandardMaterial({ color: dk(trim, .1), roughness: 0.8 }); R.mats.push(fasc);
    for (const s of [-1, 1]){ const f = new THREE.Mesh(new THREE.BoxGeometry(L + 0.1, 0.24, 0.06), fasc); f.position.set(0, H - drop - 0.1, s * D / 2); grp.add(f); }
    top = H - drop + rise;
    if (d.monitor){
      const mw = D * 0.28, baseY = H - drop + rise * (1 - (mw / 2) / (D / 2)), mh = 1.3 + rise * (mw / 2) / (D / 2);
      const vent = new THREE.Mesh(new THREE.BoxGeometry(bl * 0.9, mh, mw), new THREE.MeshStandardMaterial({ color: '#33383d', roughness: 0.9 }));
      vent.position.y = baseY + mh / 2 - 0.02; grp.add(vent); R.mats.push(vent.material);
      const cap = new THREE.Mesh(roofGeom('gable', bl * 0.9 + 1, mw + 1.4, 0.9), roofM); cap.position.y = baseY + mh; cap.castShadow = true; grp.add(cap);
      top = baseY + mh + 0.9;
    }
  } else if (type === 'arch'){
    const rr = d.archRise ?? 3;
    const roof = new THREE.Mesh(archGeom(L, D, rr), roofM); roof.position.y = H; roof.castShadow = roof.receiveShadow = true; grp.add(roof);
    top = H + rr;
    if (d.open){
      const steel = new THREE.MeshStandardMaterial({ color: trim, roughness: 0.5, metalness: 0.5 }); R.mats.push(steel);
      const n = Math.max(2, Math.round(L / 6));
      const colG = new THREE.BoxGeometry(0.35, H, 0.35);
      for (let i = 0; i <= n; i++) for (const s of [-1, 1]){
        const cm = new THREE.Mesh(colG, steel); cm.position.set(-L / 2 + ov + (L - 2 * ov) * i / n, H / 2, s * (D / 2 - ov)); cm.castShadow = true; grp.add(cm);
      }
      for (const s of [-1, 1]){ const bm = new THREE.Mesh(new THREE.BoxGeometry(L - 2 * ov, 0.5, 0.3), steel); bm.position.set(0, H - 0.25, s * (D / 2 - ov)); grp.add(bm); }
      const ribG = archGeom(0.18, D - 2 * ov, rr * (1 - (ov / (D / 2)) ** 2), 14);
      for (let i = 0; i <= n; i++){ const rm = new THREE.Mesh(ribG, steel); rm.position.set(-L / 2 + ov + (L - 2 * ov) * i / n, H - 0.05, 0); grp.add(rm); }
    }
  } else if (type === 'shed'){
    const leanSign = alongX ? (d.lean === 's' ? -1 : 1) : (d.lean === 'w' ? -1 : 1);
    const roof = new THREE.Mesh(shedGeom(L, D, leanSign, d.shedHi, d.shedLo), roofM); roof.castShadow = roof.receiveShadow = true; grp.add(roof);
    const post = new THREE.MeshStandardMaterial({ color: trim, roughness: 0.7 }); R.mats.push(post);
    const n = Math.max(1, Math.round(L / 4)); const zOut = -leanSign * (D / 2 - 0.3);
    for (let i = 0; i <= n; i++){ const p = new THREE.Mesh(new THREE.BoxGeometry(0.2, d.shedLo, 0.2), post); p.position.set(-L / 2 + 0.3 + (L - 0.6) * i / n, d.shedLo / 2, zOut); grp.add(p); }
    top = d.shedHi;
  }

  grp.traverse(o => { if (o.isMesh){ o.userData.bid = d.part && d.part !== 'outside' ? d.part : d.id; if (d.part !== 'outside') pickables.push(o); } });
  world.add(grp);
  R.boxes.push({ rect: d.rect, top });
  if (!R.swatch) R.swatch = d.roof;
  if (d.label) R.label = d.label;
  return grp;
}

/* ---------- props ---------- */
function mesh(geo, color, opts = {}){ const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.7, metalness: opts.metal ?? 0 })); m.castShadow = opts.shadow !== false; m.receiveShadow = true; return m; }
function at(px, py, y = 0){ return new THREE.Vector3(wx(px), y, wz(py)); }
function textCanvas(w, h, draw){ const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); return c; }
const SIGN_FONT = '"IBM Plex Sans Thai","Noto Sans Thai","Leelawadee UI","Tahoma",sans-serif';

function addProps(){
  const g = new THREE.Group(); g.name = 'props'; world.add(g);
  const Rgate = reg('gate'), Rtower = reg('tower'), Rcourts = reg('courts'), Rtrack = reg('track'), Rpond = reg('pond'), RD = reg('D');
  const tag = (o, id) => o.traverse(n => { if (n.isMesh){ n.userData.bid = id; pickables.push(n); REG[id].mats.push(n.material); } });

  // fence along the main road: yellow posts, white rails, red base stripe
  const roadY = x => x < 400 ? 204 - (x / 400) * 8 : 196 - ((x - 400) / 400) * 10;
  const posts = [], rails = [];
  const runs = [[20, 298], [350, 358], [377, 736]];
  runs.forEach(([a, b]) => { for (let x = a; x <= b; x += 2.5 / S) posts.push([x, roadY(x) + 14]); rails.push([a, b]); });
  const postG = new THREE.BoxGeometry(0.28, 1.25, 0.28); postG.translate(0, 0.625, 0);
  const postM = new THREE.InstancedMesh(postG, new THREE.MeshStandardMaterial({ color: '#e7b92c', roughness: 0.6 }), posts.length);
  const tmp = new THREE.Object3D();
  posts.forEach(([x, y], i) => { tmp.position.set(wx(x), 0, wz(y)); tmp.updateMatrix(); postM.setMatrixAt(i, tmp.matrix); });
  postM.castShadow = true; g.add(postM); tag(postM, 'gate');
  rails.forEach(([a, b]) => {
    const ya = roadY(a) + 14, yb = roadY(b) + 14, len = Math.hypot((b - a) * S, (yb - ya) * S), ang = Math.atan2((yb - ya), (b - a));
    const mid = at((a + b) / 2, (ya + yb) / 2);
    [[0.25, 0.5, '#f1f0ea'], [0.12, 0.08, '#b3302a']].forEach(([hgt, y, col], k) => {
      for (const yy of (k === 0 ? [0.55, 1.05] : [0.2])){
        const r = mesh(new THREE.BoxGeometry(len, k === 0 ? 0.1 : 0.4, 0.12), col); r.position.copy(mid).setY(yy); r.rotation.y = -ang; g.add(r); tag(r, 'gate');
      }
    });
  });

  // school sign wall west of the gate (faces the road)
  const signTex = canvasTex(textCanvas(1024, 150, (c, w, h) => {
    c.fillStyle = '#6d4a2f'; c.fillRect(0, 0, w, h); c.fillStyle = '#6f8796'; c.fillRect(22, 16, w - 44, h - 32);
    c.fillStyle = '#e8c65e'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '600 60px ' + SIGN_FONT; c.fillText('โรงเรียนวังหลวงพิทยาสรรพ์', w / 2, 64);
    c.font = '500 24px ' + SIGN_FONT; c.fillText('สำนักงานเขตพื้นที่การศึกษามัธยมศึกษาหนองคาย', w / 2, 112);
  }));
  signTex.wrapS = signTex.wrapT = THREE.ClampToEdgeWrapping;
  const wood = new THREE.MeshStandardMaterial({ color: '#6d4a2f', roughness: 0.8 });
  const sign = new THREE.Mesh(new THREE.BoxGeometry(16, 2.2, 0.5), [wood, wood, wood, wood, wood, new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.6 })]);
  sign.position.copy(at(324, roadY(324) + 15, 1.45)); sign.castShadow = true; g.add(sign); tag(sign, 'gate');
  const plinth = mesh(new THREE.BoxGeometry(17, 0.35, 1.2), '#8a6a4c'); plinth.position.copy(at(324, roadY(324) + 15, 0.17)); g.add(plinth); tag(plinth, 'gate');
  const logoTex = canvasTex(textCanvas(128, 128, (c) => {
    c.fillStyle = '#b3302a'; c.beginPath(); c.arc(64, 64, 62, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#e8b62c'; c.beginPath(); c.arc(64, 64, 50, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#b3302a'; c.font = '700 38px ' + SIGN_FONT; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('ว.พ.', 64, 70);
  }));
  const logo = new THREE.Mesh(new THREE.CircleGeometry(0.8, 32), new THREE.MeshStandardMaterial({ map: logoTex, roughness: 0.5, side: THREE.DoubleSide }));
  logo.position.copy(at(324, roadY(324) + 15 - 0.8, 3.2)); logo.rotation.y = Math.PI; g.add(logo); tag(logo, 'gate');

  // ศาลา/ซุ้มประตูหน้า รร คร่อมถนนภายใน ตรงทางออก (จากภาพถ่ายผู้ใช้): เสาไม้คู่ 2 ข้าง ฝ้าเพดานครีม หลังคา 3 ชั้นสีเข้ม ป้ายไม้ชื่อโรงเรียน
  const gy = 250, gxL = 354, gxR = 379, gcx = (gxL + gxR) / 2, gSpan = (gxR - gxL) * S;
  const logM = '#9a4a2e', dkRoof = '#4a4340';
  for (const x of [gxL, gxR]) for (const dy of [-2.4 / S, 2.4 / S]) for (const dx of [-0.5 / S, 0.5 / S]){
    const p = mesh(new THREE.BoxGeometry(0.46, 4.6, 0.46), logM); p.position.copy(at(x + dx, gy + dy, 2.3)); g.add(p); tag(p, 'gate');
    const pb = mesh(new THREE.BoxGeometry(0.8, 0.35, 0.8), '#d9a7a1'); pb.position.copy(at(x + dx, gy + dy, 0.18)); g.add(pb); tag(pb, 'gate'); }
  const ceil = mesh(new THREE.BoxGeometry(gSpan + 2.6, 0.22, 5.6), '#ead9b6'); ceil.position.copy(at(gcx, gy, 4.7)); g.add(ceil); tag(ceil, 'gate');
  for (const sd of [-1, 1]){ const fb = mesh(new THREE.BoxGeometry(gSpan + 2.8, 0.34, 0.2), '#6e3524'); fb.position.copy(at(gcx, gy + sd * 2.8 / S, 4.95)); g.add(fb); tag(fb, 'gate'); }
  const tierM = () => new THREE.MeshStandardMaterial({ color: dkRoof, map: ribTex, roughness: 0.55, metalness: 0.2, side: THREE.DoubleSide });
  [[gSpan + 2.8, 6.2, 1.0, 5.0], [gSpan - 0.6, 3.8, 0.95, 5.9], [Math.max(3, gSpan - 5), 2.4, 1.0, 6.75]].forEach(([L, D, r, y]) => {
    const t = new THREE.Mesh(roofGeom('hip', L, D, r), tierM()); t.position.copy(at(gcx, gy, y)); t.castShadow = true; g.add(t); tag(t, 'gate'); });
  const boardTex = canvasTex(textCanvas(512, 80, (c, w, h) => { c.fillStyle = '#6f3a27'; c.fillRect(0, 0, w, h); c.fillStyle = '#f0d27a'; c.font = '600 32px ' + SIGN_FONT; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('โรงเรียนวังหลวงพิทยาสรรพ์', w / 2, h / 2 + 2); }));
  boardTex.wrapS = boardTex.wrapT = THREE.ClampToEdgeWrapping;
  for (const sd of [-1, 1]){
    const board = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 0.72), new THREE.MeshStandardMaterial({ map: boardTex, roughness: 0.6, side: THREE.DoubleSide }));
    board.position.copy(at(gcx, gy, 4.1)).add(new THREE.Vector3(0, 0, sd * 0.2)); board.rotation.y = sd < 0 ? Math.PI : 0; g.add(board); tag(board, 'gate'); }

  // flags along the fence near the gate
  const flagTex = (kind) => canvasTex(textCanvas(96, 64, (c, w, h) => {
    if (kind === 'th'){ const b = [['#a51931',1],['#f4f5f8',1],['#2d2a4a',2],['#f4f5f8',1],['#a51931',1]]; let y = 0; b.forEach(([col, n]) => { c.fillStyle = col; c.fillRect(0, y, w, h * n / 6); y += h * n / 6; }); }
    else { c.fillStyle = kind === 'y' ? '#f0c230' : '#2f6fc0'; c.fillRect(0, 0, w, h); }
  }));
  const FT = { th: flagTex('th'), y: flagTex('y'), b: flagTex('b') };
  const poleG = new THREE.CylinderGeometry(0.05, 0.06, 6, 6); poleG.translate(0, 3, 0);
  const seq = ['th', 'y', 'th', 'b'];
  let fi = 0;
  for (let x = 236; x <= 296; x += 4 / S){ addFlag(x); }
  for (let x = 386; x <= 432; x += 4 / S){ addFlag(x); }
  function addFlag(x){
    const y = roadY(x) + 16; const p = mesh(poleG, '#d9dbdc', { metal: 0.6, rough: 0.35 }); p.position.copy(at(x, y)); g.add(p); tag(p, 'gate');
    const f = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.0), new THREE.MeshStandardMaterial({ map: FT[seq[fi++ % seq.length]], side: THREE.DoubleSide, roughness: 0.9 }));
    f.position.copy(at(x, y, 5.4)).add(new THREE.Vector3(0.78, 0, 0)); f.rotation.y = Math.PI; g.add(f); tag(f, 'gate');
  }

  // water tower (blue column, yellow ball tank)
  const tw = new THREE.Group(); tw.position.copy(at(352, 742));
  const col = mesh(new THREE.CylinderGeometry(0.32, 0.45, 13, 12), '#3b74c4'); col.position.y = 6.5; tw.add(col);
  const ball = mesh(new THREE.SphereGeometry(2.1, 24, 16), '#e8b62c', { rough: 0.45 }); ball.position.y = 14.6; tw.add(ball);
  const cap = mesh(new THREE.ConeGeometry(0.5, 0.9, 10), '#3b74c4'); cap.position.y = 17.0; tw.add(cap);
  const foot = mesh(new THREE.CylinderGeometry(1.1, 1.3, 0.5, 12), '#bdbab2'); foot.position.y = 0.25; tw.add(foot);
  // โรงอาหาร (H): โดมเปิดโล่งไม่มีผนัง · แถวร้านค้าท้ายโดม (ปลายใต้ ตำแหน่งประมาณ) · โต๊ะโรงอาหารด้านใน
  { const RH = reg('H'), cg = new THREE.Group(); cg.position.copy(at(692.5, 469));
    const px = 9.3, hz = 20.2, Hh = 5.6;
    const post = new THREE.BoxGeometry(0.32, Hh, 0.32), steel = '#8e8f89';
    for (const sx of [-1, 1]) for (let z = -hz; z <= hz + 0.1; z += hz / 4){ const m = mesh(post, steel); m.position.set(sx * px, Hh / 2 + 0.15, z); cg.add(m); }
    const floor = mesh(new THREE.BoxGeometry(px * 2 + 1.2, 0.12, hz * 2 + 1.2), '#c9c6bd', { shadow: false }); floor.position.y = 0.12; cg.add(floor);
    // ร้านค้าเรียงกันที่ปลายใต้
    const awn = ['#d7342b', '#2f62d9', '#f2b21c', '#2e9f5b', '#e0823a', '#8e5bc6'], sw = (px * 2) / awn.length;
    awn.forEach((c, i) => { const x = -px + sw * (i + 0.5);
      const wall = mesh(new THREE.BoxGeometry(sw - 0.12, 3.0, 3.0), '#ece7dc'); wall.position.set(x, 1.65, hz - 1.5); cg.add(wall);
      const counter = mesh(new THREE.BoxGeometry(sw - 0.5, 1.0, 0.7), '#a98a63'); counter.position.set(x, 0.62, hz - 3.4); cg.add(counter);
      const aw = mesh(new THREE.BoxGeometry(sw - 0.1, 0.12, 1.5), c); aw.position.set(x, 3.0, hz - 3.6); aw.rotation.x = -0.18; cg.add(aw); });
    // โต๊ะโรงอาหาร 3 แถว × 10 แถวลึก
    const topG = new THREE.BoxGeometry(4.2, 0.06, 0.8), benG = new THREE.BoxGeometry(4.2, 0.06, 0.28);
    for (const tx of [-6.2, 0, 6.2]) for (let i = 0; i < 10; i++){ const z = -hz + 3 + i * 3.4;
      const top = mesh(topG, '#cdb892', { shadow: false }); top.position.set(tx, 0.78, z); cg.add(top);
      for (const bz of [-0.75, 0.75]){ const b = mesh(benG, '#8d6e4a', { shadow: false }); b.position.set(tx, 0.46, z + bz); cg.add(b); } }
    g.add(cg); cg.traverse(n => { if (n.isMesh){ n.userData.bid = 'H'; pickables.push(n); RH.mats.push(n.material); } }); }
  // ศาลาอินทนิล (W1): พื้นยกสูงปูกระเบื้องสีน้ำเงิน เสากลม ไม่มีผนัง
  { const RW = reg('W1'), wg = new THREE.Group(); wg.position.copy(at(360.5, 542.5));
    const bx = 10.6, bz = 13.6;
    const conc = mesh(new THREE.BoxGeometry(bx, 0.45, bz), '#b9b6ae'); conc.position.y = 0.225; wg.add(conc);
    const tile = mesh(new THREE.BoxGeometry(bx - 0.15, 0.12, bz - 0.15), '#2f6fc0', { shadow: false }); tile.position.y = 0.5; wg.add(tile);
    const stepM = mesh(new THREE.BoxGeometry(2.6, 0.25, 0.7), '#a9a69e'); stepM.position.set(0, 0.125, bz / 2 + 0.35); wg.add(stepM);
    for (const sx of [-1, 1]) for (const z of [-5.8, 0, 5.8]){ const po = mesh(new THREE.CylinderGeometry(0.17, 0.17, 3.55, 12), '#efe9de'); po.position.set(sx * 4.6, 0.55 + 3.55 / 2, z); wg.add(po); }
    g.add(wg); wg.traverse(n => { if (n.isMesh){ n.userData.bid = 'W1'; pickables.push(n); RW.mats.push(n.material); } }); }
  // สแตนเชียร์ 4 สี + ป้ายใหญ่ ริมสนามฟุตบอลด้านตะวันตก (ตามภาพถ่ายงานกีฬาสี) หันหน้าเข้าสนาม — ตำแหน่งตามแนวภาพ ประมาณ
  { const RS = reg('stands'), SX = 98;
    const mkStand = (y, col) => {
      const st = new THREE.Group(); st.position.copy(at(SX, y));
      const back = mesh(new THREE.BoxGeometry(0.4, 6.4, 9.4), col); back.position.set(-2.2, 3.4, 0); st.add(back);
      const panel = mesh(new THREE.BoxGeometry(0.1, 3.2, 6.6), '#f1ede0', { shadow: false }); panel.position.set(-1.95, 4.0, 0); st.add(panel);
      for (const sd of [-1, 1]){ const tw = mesh(new THREE.BoxGeometry(1.3, 8.2, 1.3), col); tw.position.set(-2.2, 4.1, sd * 5.0); st.add(tw);
        const cap = mesh(new THREE.ConeGeometry(1.1, 1.8, 4), '#f2c230'); cap.position.set(-2.2, 9.2, sd * 5.0); cap.rotation.y = Math.PI / 4; st.add(cap); }
      [0, 1, 2].forEach(k => { const step = mesh(new THREE.BoxGeometry(1.1, 0.5 + k * 0.5, 9.0), '#c9c4b6', { shadow: false }); step.position.set(-1.0 + (2 - k) * 1.1 - 0.3, (0.5 + k * 0.5) / 2, 0); st.add(step); });
      const flag = mesh(new THREE.BoxGeometry(0.05, 1.0, 1.6), col, { shadow: false }); flag.position.set(-2.2, 10.2, 0); st.add(flag);
      g.add(st); st.traverse(n => { if (n.isMesh){ n.userData.bid = 'stands'; pickables.push(n); RS.mats.push(n.material); } });
    };
    [[454, '#e8822a'], [497, '#3aa05a'], [583, '#3a6fd1'], [629, '#e8739f']].forEach(([y, c]) => mkStand(y, c));
    // ป้ายใหญ่กลางแนวสแตน
    const bcv = document.createElement('canvas'); bcv.width = 768; bcv.height = 256;
    const bt = canvasTex(bcv);
    const setSign = (lines) => {   // ข้อความป้ายใหญ่เปลี่ยนตามโหมดงาน
      const c = bcv.getContext('2d'), w = 768, h = 256;
      c.fillStyle = '#2f8a58'; c.fillRect(0, 0, w, h); c.fillStyle = '#f4e9b8'; c.fillRect(14, 14, w - 28, h - 28);
      c.fillStyle = '#2f8a58'; c.textAlign = 'center'; c.textBaseline = 'middle';
      lines.forEach((t, i) => { let px = i ? 52 : 70; c.font = (i ? '600 ' : '700 ') + px + 'px ' + SIGN_FONT; while (c.measureText(t).width > w - 70 && px > 24){ px -= 2; c.font = (i ? '600 ' : '700 ') + px + 'px ' + SIGN_FONT; } c.fillText(t, w / 2, lines.length === 1 ? h / 2 : h * (0.36 + 0.3 * i)); });
      bt.needsUpdate = true;
    };
    setSign(['วังหลวงพิทยาสรรพ์']);
    bt.wrapS = bt.wrapT = THREE.ClampToEdgeWrapping;
    const sg = new THREE.Group(); sg.position.copy(at(SX, 543));
    for (const sd of [-1, 1]){ const po = mesh(new THREE.BoxGeometry(0.3, 5.4, 0.3), '#6d4a2f'); po.position.set(0, 2.7, sd * 4.4); sg.add(po); }
    const bd = new THREE.Mesh(new THREE.PlaneGeometry(9.6, 3.2), new THREE.MeshStandardMaterial({ map: bt, roughness: 0.7, side: THREE.DoubleSide })); bd.position.set(0.18, 4.1, 0); bd.rotation.y = Math.PI / 2; sg.add(bd);
    g.add(sg); sg.traverse(n => { if (n.isMesh){ n.userData.bid = 'stands'; pickables.push(n); RS.mats.push(n.material); } });
    RS.boxes.push({ rect: [90,440,106,642], top: 10 });
  }
  // เวทีมวยกลางโดมสนามมวย (I2) 6.1 × 6.1 ม. ยกพื้น เชือก 3 เส้น
  { const RI = reg('I2'), ring = new THREE.Group(); ring.position.copy(at(698, 375));
    const base = mesh(new THREE.BoxGeometry(6.6, 0.9, 6.6), '#7b838a'); base.position.y = 0.45; ring.add(base);
    const mat = mesh(new THREE.BoxGeometry(6.1, 0.12, 6.1), '#2f62d9'); mat.position.y = 0.96; ring.add(mat);
    [[-1, -1, '#d7342b'], [1, -1, '#2f62d9'], [-1, 1, '#f1f0ea'], [1, 1, '#f1f0ea']].forEach(([sx, sz, c]) => { const post = mesh(new THREE.BoxGeometry(0.16, 1.5, 0.16), c); post.position.set(sx * 2.95, 1.7, sz * 2.95); ring.add(post); });
    [0, 1, 2].forEach(k => { const y = 1.35 + k * 0.4, c = k === 1 ? '#f1f0ea' : '#d7342b';
      [-1, 1].forEach(sd => { const rx = mesh(new THREE.BoxGeometry(5.9, 0.06, 0.06), c); rx.position.set(0, y, sd * 2.95); ring.add(rx); const rz = mesh(new THREE.BoxGeometry(0.06, 0.06, 5.9), c); rz.position.set(sd * 2.95, y, 0); ring.add(rz); }); });
    g.add(ring); ring.traverse(n => { if (n.isMesh){ n.userData.bid = 'I2'; pickables.push(n); RI.mats.push(n.material); } }); }
  g.add(tw); tag(tw, 'tower'); Rtower.boxes.push({ rect: [347,737,357,747], top: 17.5 });

  // basketball hoops
  const hoop = (px, py, face) => {
    const h = new THREE.Group(); h.position.copy(at(px, py)); h.rotation.y = face;
    const pole = mesh(new THREE.CylinderGeometry(0.08, 0.1, 3.4, 8), '#3a3f44'); pole.position.set(0, 1.7, -0.9); h.add(pole);
    const arm = mesh(new THREE.BoxGeometry(0.08, 0.08, 0.9), '#3a3f44'); arm.position.set(0, 3.2, -0.45); h.add(arm);
    const bb = mesh(new THREE.BoxGeometry(1.8, 1.05, 0.05), '#f4f4f1'); bb.position.set(0, 3.45, 0); h.add(bb);
    const ring = mesh(new THREE.TorusGeometry(0.23, 0.02, 6, 16), '#e0662b'); ring.rotation.x = Math.PI / 2; ring.position.set(0, 3.05, 0.3); h.add(ring);
    g.add(h); tag(h, 'courts');
  };
  hoop(COURT_BX + 4, 410, Math.PI / 2); hoop(COURT_BX + 88, 410, -Math.PI / 2);
  Rcourts.boxes.push({ rect: [COURT_BX, 380, COURT_BX + 92, 440], top: 4 });

  // volleyball / sepak takraw nets: two posts and a see-through net across the middle of each court
  const Rcourts2 = reg('courts2'), Rpet = reg('petanque');
  const net = ([x0, y0, x1, y1], postH, netH, id, turn) => {
    const wm = (turn ? y1 - y0 : x1 - x0) * S, n = new THREE.Group(); n.position.copy(at((x0 + x1) / 2, (y0 + y1) / 2)); if (turn) n.rotation.y = Math.PI / 2;
    [-1, 1].forEach(s => { const p = mesh(new THREE.CylinderGeometry(0.05, 0.06, postH, 8), '#3a3f44'); p.position.set(s * (wm / 2 + 0.35), postH / 2, 0); n.add(p); });
    const mesh2 = new THREE.Mesh(new THREE.PlaneGeometry(wm + 0.7, netH), new THREE.MeshStandardMaterial({ color: '#f4f4f1', transparent: true, opacity: 0.42, side: THREE.DoubleSide, roughness: 0.9 }));
    mesh2.position.set(0, postH - netH / 2, 0); n.add(mesh2);
    const tape = mesh(new THREE.BoxGeometry(wm + 0.7, 0.07, 0.04), '#f4f4f1'); tape.position.set(0, postH - 0.03, 0); n.add(tape);
    g.add(n); tag(n, id);
  };
  VB_COURT.forEach(c => net(c, 2.43, 1.0, 'courts2'));
  TK_COURTS.forEach(c => net(c, 1.6, 0.7, 'courts2'));
  reg('farm').boxes.push({ rect: FARM, top: 1 });
  reg('beach'); net(BEACH, 2.43, 1.0, 'beach', true);
  REG.beach.boxes.push({ rect: [200, 724, 262, 750], top: 2.6 });
  Rcourts2.boxes.push({ rect: [520, 380, 612, 440], top: 2.6 });
  Rpet.boxes.push({ rect: [434, 299, 510, 323], top: 1 });

  // football goals
  const goal = (py, face) => {
    const gg = new THREE.Group(); gg.position.copy(at(211, py)); gg.rotation.y = face;
    const w = 7.32, hgt = 2.44, t = 0.12;
    [[-w / 2, 0], [w / 2, 0]].forEach(([x]) => { const p = mesh(new THREE.BoxGeometry(t, hgt, t), '#f7f7f5'); p.position.set(x, hgt / 2, 0); gg.add(p); });
    const bar = mesh(new THREE.BoxGeometry(w + t, t, t), '#f7f7f5'); bar.position.set(0, hgt, 0); gg.add(bar);
    const net = new THREE.Mesh(new THREE.PlaneGeometry(w, hgt), new THREE.MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0.25, side: THREE.DoubleSide })); net.position.set(0, hgt / 2, -1.2); net.rotation.x = -0.35; gg.add(net);
    g.add(gg); tag(gg, 'track');
  };
  goal(409.5, 0); goal(696.5, Math.PI);
  Rtrack.boxes.push({ rect: [102,318,320,789], top: 3 });

  // แท่นหน้าโดมด้านตะวันตก (ผู้ใช้วาด 22 พ.ย.): พระพุทธรูปทอง · เสาธง 3 ต้นติดโดม · ซุ้มพระบรมฉายาลักษณ์ปลายใต้ — ตำแหน่ง/ขนาดประมาณจากภาพวาด
  const plat = mesh(new THREE.BoxGeometry(14 * S, 0.45, 64 * S), '#ece8df'); plat.position.copy(at(420, 544, 0.225)); g.add(plat); tag(plat, 'D');
  const bu = new THREE.Group(); bu.position.copy(at(419, 567, 0.45)); bu.rotation.y = -Math.PI / 2;
  const ped = mesh(new THREE.BoxGeometry(2.6, 1.1, 2.2), '#f0d9d6'); ped.position.y = 0.55; bu.add(ped);
  const gold = { rough: 0.3, metal: 0.8 };
  const lotus = mesh(new THREE.CylinderGeometry(1.0, 0.8, 0.45, 16), '#d4a93c', gold); lotus.position.y = 1.32; bu.add(lotus);
  const lap = mesh(new THREE.SphereGeometry(0.85, 16, 12), '#d4a93c', gold); lap.scale.set(1.2, 0.45, 0.85); lap.position.y = 1.75; bu.add(lap);
  const body = mesh(new THREE.SphereGeometry(0.55, 16, 12), '#d4a93c', gold); body.scale.set(1, 1.5, 0.8); body.position.y = 2.45; bu.add(body);
  const head = mesh(new THREE.SphereGeometry(0.28, 16, 12), '#d4a93c', gold); head.position.y = 3.35; bu.add(head);
  const ush = mesh(new THREE.ConeGeometry(0.1, 0.4, 10), '#d4a93c', gold); ush.position.y = 3.75; bu.add(ush);
  g.add(bu); tag(bu, 'D');
  // เสาธง 3 ต้น (กลางสูงสุด ธงชาติ · ข้างซ้ายขวา ธงสีน้ำเงิน ตามภาพวาด) ชิดชายคาโดม
  [[535, 7.6, 'side'], [546, 9.2, 'main'], [557, 7.6, 'side']].forEach(([py, ph, kind]) => {
    const fp = new THREE.Group(); fp.position.copy(at(423.2, py, 0.45));
    const pb = mesh(new THREE.CylinderGeometry(0.45, 0.55, 0.3, 14), '#cfcdc6'); pb.position.y = 0.15; fp.add(pb);   // ฐานเสาแยกต้น
    const pole = mesh(new THREE.CylinderGeometry(0.06, 0.09, ph, 8), '#d9dcdd', { rough: 0.3, metal: 0.6 }); pole.position.y = ph / 2; fp.add(pole);
    const ball = mesh(new THREE.SphereGeometry(0.13, 8, 6), '#d4a93c', gold); ball.position.y = ph + 0.1; fp.add(ball);
    const fw = 1.9, fh = 1.25, cols = kind === 'main' ? ['#c8283a', '#f4f4f1', '#2a3a8a', '#f4f4f1', '#c8283a'] : ['#2a3a8a'];
    const sh = fh / (kind === 'main' ? 6 : 1), hs = kind === 'main' ? [1, 1, 2, 1, 1] : [6];
    let yy = ph - 0.15;
    cols.forEach((cl, i) => { const hh = sh * hs[i]; const st = mesh(new THREE.BoxGeometry(0.03, hh, fw), cl, { shadow: false }); st.position.set(0, yy - hh / 2, fw / 2 + 0.06); fp.add(st); yy -= hh; });
    g.add(fp); tag(fp, 'D');
  });
  // ซุ้มพระบรมฉายาลักษณ์ หลังคาทรงไทย บนแท่นปลายใต้
  { const sz = new THREE.Group(); sz.position.copy(at(419, 523, 0.45));
    const base = mesh(new THREE.BoxGeometry(2.6, 0.3, 2.2), '#d9d2c2'); base.position.y = 0.15; sz.add(base);
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b]) => { const c = mesh(new THREE.BoxGeometry(0.16, 2.6, 0.16), '#f1ece2'); c.position.set(a * 1.1, 1.6, b * 0.9); sz.add(c); });
    const pic = mesh(new THREE.BoxGeometry(0.06, 1.3, 1.0), '#c9a24a', gold); pic.position.set(-0.8, 1.35, 0); sz.add(pic);
    const rf = new THREE.Mesh(roofGeom('gable', 3.2, 2.8, 1.1), new THREE.MeshStandardMaterial({ color: '#b3302a', roughness: 0.5, side: THREE.DoubleSide })); rf.position.y = 2.9; rf.castShadow = true; sz.add(rf);
    const fin = mesh(new THREE.ConeGeometry(0.08, 0.5, 6), '#d4a93c', gold); fin.position.y = 4.2; sz.add(fin);
    g.add(sz); tag(sz, 'D'); }

  // pond: water, pavilion, bridge
  const shape = new THREE.Shape(); const rr = (x, y, w, h, r) => { shape.moveTo(x + r, y); shape.lineTo(x + w - r, y); shape.quadraticCurveTo(x + w, y, x + w, y + r); shape.lineTo(x + w, y + h - r); shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h); shape.lineTo(x + r, y + h); shape.quadraticCurveTo(x, y + h, x, y + h - r); shape.lineTo(x, y + r); shape.quadraticCurveTo(x, y, x + r, y); };
  rr(wx(155), -wz(995), 165 * S, 138 * S, 4.5);
  const wg = new THREE.ShapeGeometry(shape, 8); wg.rotateX(-Math.PI / 2);
  const water = new THREE.Mesh(wg, new THREE.MeshStandardMaterial({ color: '#3d6a5c', roughness: 0.12, metalness: 0.05 }));
  water.position.y = 0.06; water.receiveShadow = true; g.add(water); tag(water, 'pond');
  const deck = mesh(new THREE.BoxGeometry(66 * S, 0.25, 8 * S), '#8a6a4c'); deck.position.copy(at(287, 926, 0.7)); g.add(deck); tag(deck, 'pond');
  const pav = new THREE.Group(); pav.position.copy(at(238, 926));   // ศาลากลางน้ำ อยู่กึ่งกลางบ่อ (ผู้ใช้ระบุ)
  const pf = mesh(new THREE.BoxGeometry(32 * S - 1, 0.3, 28 * S - 1), '#a07d5a'); pf.position.y = 0.75; pav.add(pf);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]){ const p = mesh(new THREE.BoxGeometry(0.25, 3, 0.25), '#f1ece2'); p.position.set(sx * (32 * S / 2 - 1), 2.2, sz * (28 * S / 2 - 1)); pav.add(p); }
  const prf = new THREE.Mesh(roofGeom('hip', 32 * S + 1, 28 * S + 1, 2.2), new THREE.MeshStandardMaterial({ color: '#2f6fc0', map: ribTex, roughness: 0.5, metalness: 0.15, side: THREE.DoubleSide }));
  prf.position.y = 3.6; prf.castShadow = true; pav.add(prf);
  g.add(pav); tag(pav, 'pond'); Rpond.boxes.push({ rect: [155,857,320,995], top: 6 });
  Rgate.boxes.push({ rect: [300,205,382,262], top: 7 });
  // หมาจร 4 ตัว ที่สามแยกไปบ้านพักครู (ผู้ใช้ขอ 22 พ.ย. · ตำแหน่งสามแยกเดา = ถนนฝั่งตะวันออกชนถนนบ้านพัก)
  // สัตว์เลี้ยง/หมาจร: คลิกได้ (กล่องจับคลิกที่มองไม่เห็น) ไม่มีสัญลักษณ์บนแผนที่ ไม่อยู่ในรายการอาคาร
  const petClick = (grp, id, px, py, info, h) => {
    const hit = new THREE.Mesh(new THREE.BoxGeometry(1.6, h + 0.5, 1.6), new THREE.MeshBasicMaterial({ visible: false })); hit.position.y = (h + 0.5) / 2; grp.add(hit);
    const R = reg(id); R.boxes.push({ rect: [px - 2, py - 2, px + 2, py + 2], top: 1 }); INFO[id] = { pet: true, src: 'sat', facts: [], ...info };
    tag(grp, id);
  };
  const dog = (px, py, rot, { len = 0.9, hgt = 0.55, color = '#1d1d1f', thin = 1, limp = false, name = '', fluff = false, id = '', info = null }) => {
    const d = new THREE.Group(); d.position.copy(at(px, py)); d.rotation.y = rot;
    const bw = 0.22 * hgt / 0.55 * thin, lh = hgt * 0.55;
    const body = mesh(new THREE.BoxGeometry(len, bw, bw * 1.05), color); body.position.set(0, lh + bw / 2, 0); d.add(body);
    const head = mesh(new THREE.BoxGeometry(len * 0.26, bw * 0.95, bw * 0.9), color); head.position.set(len / 2 + len * 0.1, lh + bw * 0.85, 0); d.add(head);
    const snout = mesh(new THREE.BoxGeometry(len * 0.14, bw * 0.45, bw * 0.5), color); snout.position.set(len / 2 + len * 0.3, lh + bw * 0.7, 0); d.add(snout);
    [-1, 1].forEach(sz => { const ear = mesh(new THREE.BoxGeometry(0.05, bw * 0.5, 0.04), color); ear.position.set(len / 2 + len * 0.05, lh + bw * 1.35, sz * bw * 0.35); d.add(ear); });
    const tail = mesh(new THREE.BoxGeometry(len * 0.35, 0.04, 0.04), color); tail.position.set(-len / 2 - len * 0.12, lh + bw * 0.9, 0); tail.rotation.z = -0.6; d.add(tail);
    [[len * 0.36, -1], [len * 0.36, 1], [-len * 0.36, -1], [-len * 0.36, 1]].forEach(([lx, sz], i) => {
      const hh = (limp && i === 1) ? lh * 0.45 : lh;   // ขาหน้าข้างหนึ่งเป๋ งอสั้น
      const leg = mesh(new THREE.BoxGeometry(0.07 * thin, hh, 0.07 * thin), color); leg.position.set(lx, (limp && i === 1) ? lh - hh / 2 : hh / 2, sz * bw * 0.38); d.add(leg);
    });
    if (limp) d.rotation.z = 0.05;
    if (fluff){ const fr = mesh(new THREE.SphereGeometry(1, 10, 8), color, { rough: 1 }); fr.scale.set(len * 0.55, bw * 1.5, bw * 1.5); fr.position.set(0, lh + bw * 0.75, 0); d.add(fr); tail.scale.set(1.4, 3, 3); }
    if (id) petClick(d, id, px, py, info, hgt);
    if (name){   // ป้ายชื่อหมา ลอยเหนือตัว (ตัวเล็ก เห็นตอนซูมใกล้)
      const c = document.createElement('canvas'); c.width = 256; c.height = 80; const cg = c.getContext('2d');
      cg.fillStyle = 'rgba(250,249,244,.93)'; cg.beginPath(); cg.roundRect(4, 8, 248, 64, 30); cg.fill();
      cg.fillStyle = '#1c211e'; cg.font = '600 40px "IBM Plex Sans Thai",sans-serif'; cg.textAlign = 'center'; cg.textBaseline = 'middle'; cg.fillText(name, 128, 42);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
      sp.scale.set(2.2, 0.69, 1); sp.position.y = hgt + 0.9; sp.renderOrder = 10; d.add(sp);
    }
    g.add(d);
  };
  dog(662, 944, 0.6, { len: 1.15, hgt: 0.68, color: '#17171a', name: 'สีนิล', id: 'pet_sinin', info: { name: 'สีนิล', kind: 'หมาจร · สีดำ ตัวใหญ่', facts: [['อยู่แถว', 'สามแยกไปบ้านพักครู']] } });                     // ดำตัวใหญ่
  dog(676, 953, -2.3, { len: 0.9, hgt: 0.5, color: '#c58a3a', limp: true, name: 'ขาฮ่าง', id: 'pet_khahang', info: { name: 'ขาฮ่าง', kind: 'หมาจร · สีเหลือง ขาเป๋', facts: [['อยู่แถว', 'สามแยกไปบ้านพักครู']] } });          // สีเหลืองน้ำตาล ขาเป๋
  dog(668, 938, 2.2, { len: 0.7, hgt: 0.42, color: '#1d1d1f', thin: 0.65, id: 'pet_dog3', info: { name: 'หมาจร (ไม่มีชื่อ)', kind: 'หมาจร · สีดำ ตัวเล็ก ผอม', facts: [['อยู่แถว', 'สามแยกไปบ้านพักครู']] } });          // ดำเล็ก ผอม
  dog(683, 945, 0.2, { len: 0.7, hgt: 0.42, color: '#222225', thin: 0.65, id: 'pet_dog4', info: { name: 'หมาจร (ไม่มีชื่อ)', kind: 'หมาจร · สีดำ ตัวเล็ก ผอม', facts: [['อยู่แถว', 'สามแยกไปบ้านพักครู']] } });          // ดำเล็ก ผอม
  // ชิวาวาขนฟู 2 ตัว หน้าบ้านพักครู (บ้านสันหลังคายาว 4 ช่อง ตำแหน่งเดาจากภาพ)
  dog(621, 946.5, 0.4, { len: 0.38, hgt: 0.24, color: '#17171a', fluff: true, name: 'เฉาก๊วย', id: 'pet_chaokuay', info: { name: 'เฉาก๊วย', kind: 'ชิวาวา · ขนฟู สีดำ', facts: [['อยู่ที่', 'บ้านพักครูหลังนี้']] } });
  dog(630, 946.5, -0.5, { len: 0.38, hgt: 0.24, color: '#f2f0ea', fluff: true, name: 'โซ่', id: 'pet_so', info: { name: 'โซ่', kind: 'ชิวาวา · ขนฟู สีขาว', facts: [['อยู่ที่', 'บ้านพักครูหลังนี้']] } });
  // แมวกะทิ ขาวเทา นั่งบนหลังคาบ้านพักหลังบนสุดของสามแยก (ผู้ใช้บอก 22 พ.ย.) — บ้าน [675,919,704,941] สันหลังคาตามแกน x ลาดไปทางใต้
  { const ct = new THREE.Group(), P = 28 * Math.PI / 180, ridgeY = 0.3 + 2 * 2.8 + (22 * S / 2 + 0.7) * Math.tan(P), dd = 1.0;
    ct.position.copy(at(690, 930 + dd / S, ridgeY - dd * Math.tan(P) + 0.02)); ct.rotation.x = P; ct.rotation.y = 0.5;
    const cw = '#dcdcd8', cg2 = '#9a9a98';
    const cb = mesh(new THREE.BoxGeometry(0.42, 0.2, 0.22), cw); cb.position.set(0, 0.1, 0); ct.add(cb);
    const sp2 = mesh(new THREE.BoxGeometry(0.2, 0.021, 0.23), cg2, { shadow: false }); sp2.position.set(-0.04, 0.201, 0); ct.add(sp2);
    const ch = mesh(new THREE.BoxGeometry(0.17, 0.15, 0.17), cw); ch.position.set(0.25, 0.2, 0); ct.add(ch);
    [-1, 1].forEach(z => { const e = mesh(new THREE.ConeGeometry(0.04, 0.09, 4), cg2); e.position.set(0.27, 0.32, z * 0.055); ct.add(e); });
    const tl = mesh(new THREE.BoxGeometry(0.3, 0.05, 0.05), cg2); tl.position.set(-0.3, 0.07, 0.1); tl.rotation.y = 0.5; ct.add(tl);
    const c2 = document.createElement('canvas'); c2.width = 256; c2.height = 80; const k = c2.getContext('2d');
    k.fillStyle = 'rgba(250,249,244,.93)'; k.beginPath(); k.roundRect(4, 8, 248, 64, 30); k.fill();
    k.fillStyle = '#1c211e'; k.font = '600 40px "IBM Plex Sans Thai",sans-serif'; k.textAlign = 'center'; k.textBaseline = 'middle'; k.fillText('กะทิ', 128, 42);
    const lb = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c2), depthTest: false, transparent: true })); lb.scale.set(2.2, 0.69, 1); lb.position.y = 1.1; lb.renderOrder = 10; ct.add(lb);
    petClick(ct, 'pet_kathi', 690, 933, { name: 'กะทิ', kind: 'แมว · ขนสีขาวเทา', facts: [['อยู่ที่', 'หลังคาบ้านพักครู หลังบนสุดของสามแยก']] }, 0.4);
    g.add(ct); }
}

/* ---------- vegetation ---------- */
function roadClear(px, py, extra){ for (const rd of ROADS){ for (let i = 1; i < rd.pts.length; i++){ const [ax, ay] = rd.pts[i - 1], [bx, by] = rd.pts[i]; if (segDist(px, py, ax, ay, bx, by) * S < rd.w / 2 + extra) return false; } } return true; }
function bldClear(px, py, m){ for (const b of BUILDINGS){ const [x0, y0, x1, y1] = b.rect; if (px > x0 - m && px < x1 + m && py > y0 - m && py < y1 + m) return false; } return true; }
function addForest(){
  const r = rng(42), pts = [];
  const cx = -45, cz = 0, R = LOW ? 250 : 330, row = 7, step = LOW ? 5.6 : 4.6;
  const roadZ = wz(190);
  const test = (x, z) => {
    const d = Math.hypot(x - cx, z - cz); if (d > R * (0.86 + 0.14 * r())) return;
    const px = x / S + OX, py = z / S + OY;
    if (CLEAR.some(p => inPoly(px, py, p))) return;
    if (!roadClear(px, py, 2.4)) return;
    if (r() < 0.05) return;
    pts.push([x + (r() - 0.5) * 1.1, z + (r() - 0.5) * 1.1]);
  };
  for (let a = -R; a <= R; a += step) for (let b = -R; b <= R; b += row){
    const ns = [cx + b, cz + a]; if (ns[1] > roadZ) test(ns[0], ns[1]);
    const ew = [cx + a, cz + b]; if (ew[1] <= roadZ) test(ew[0], ew[1]);
  }
  const trunkG = new THREE.CylinderGeometry(0.13, 0.2, 7.5, 5); trunkG.translate(0, 3.75, 0);
  const crownG = new THREE.IcosahedronGeometry(2.5, 0); crownG.scale(1, 1.3, 1); crownG.translate(0, 9.6, 0);
  const trunks = new THREE.InstancedMesh(trunkG, new THREE.MeshStandardMaterial({ color: '#6b6158', roughness: 0.9 }), pts.length);
  const crowns = new THREE.InstancedMesh(crownG, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, flatShading: true }), pts.length);
  const tmp = new THREE.Object3D(), col = new THREE.Color(), pal = ['#3d5e2a','#46692f','#517339','#3a5627','#5a7a3c','#4b6a33'];
  pts.forEach(([x, z], i) => { const s = 0.82 + r() * 0.36; tmp.position.set(x, 0, z); tmp.rotation.set(0, r() * 6.28, 0); tmp.scale.set(s, s * (0.9 + r() * 0.25), s); tmp.updateMatrix(); trunks.setMatrixAt(i, tmp.matrix); crowns.setMatrixAt(i, tmp.matrix); crowns.setColorAt(i, col.set(pal[(r() * pal.length) | 0])); });
  trunks.castShadow = crowns.castShadow = true; crowns.receiveShadow = true;
  const f = new THREE.Group(); f.name = 'forest'; f.add(trunks, crowns); scene.add(f);
  return pts.length;
}
function addCampusGreen(){
  const r = rng(7);
  const shade = [[622,372,4.2],[395,330,4],[395,400,4.5],[620,318,3.2],[655,590,4],[690,600,4.2],[708,640,3.5],[662,820,4],[700,830,4.5],[735,860,4],[690,885,3.6],
    [130,880,4],[128,935,4.2],[140,985,4],[300,1000,4],[205,1000,4.2],[255,1004,3.6],[330,215,4],[300,300,4],[250,300,4.2],[180,302,4],[120,310,4.5],[95,450,4],[95,560,4.2],[98,660,4],[640,860,3.8],[740,610,4.5],[742,700,4],[745,780,4.2],
    [362,620,3.6],[365,650,3.4],[368,760,3.8],[372,790,3.4],[330,700,3.6],[315,760,3.4],[300,800,3.6],[252,790,4.2],[230,820,3.4],[170,812,3.6]];
  for (let py = 305; py < 800; py += 11 / S){ const px = 340 + (py - 300) * 0.07; if (bldClear(px, py, 8) && roadClear(px, py, 1.5)) shade.push([px, py, 3 + r() * 1.4]); }
  const good = shade.filter(([x, y]) => bldClear(x, y, 4) && roadClear(x, y, 0.5));
  const palms = [[447,800],[470,803],[500,801],[540,806],[585,803],[628,805],[435,596],[630,596],[430,292],[655,300]].filter(([x, y]) => bldClear(x, y, 2) && roadClear(x, y, 0.5));
  const bushes = [];
  const beds = [[440,660,630,698],[448,786,630,810],[384,302,514,376],[442,280,638,288]];
  beds.forEach(([x0, y0, x1, y1]) => { const n = Math.round((x1 - x0) * (y1 - y0) * S * S / 45); for (let i = 0; i < n; i++){ const x = x0 + r() * (x1 - x0), y = y0 + r() * (y1 - y0); if (bldClear(x, y, 2) && roadClear(x, y, 0.8) && !PETANQUE.some(([a, b, c, d]) => x > a - 3 && x < c + 3 && y > b - 3 && y < d + 3)) bushes.push([x, y]); } });

  const tmp = new THREE.Object3D(), col = new THREE.Color();
  const tG = new THREE.CylinderGeometry(0.22, 0.32, 3.2, 6); tG.translate(0, 1.6, 0);
  const cG = new THREE.IcosahedronGeometry(1, 1); cG.translate(0, 0, 0);
  const trunks = new THREE.InstancedMesh(tG, new THREE.MeshStandardMaterial({ color: '#5e5044', roughness: 0.9 }), good.length);
  const crowns = new THREE.InstancedMesh(cG, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, flatShading: true }), good.length);
  const pal = ['#35602a','#3e6b2e','#4a7634','#2f5724','#557f3a'];
  good.forEach(([x, y, rad], i) => {
    tmp.position.copy(at(x, y)); tmp.rotation.set(0, 0, 0); tmp.scale.set(1, 1 + rad / 8, 1); tmp.updateMatrix(); trunks.setMatrixAt(i, tmp.matrix);
    tmp.position.y = 2.6 + rad * 0.85; tmp.rotation.set(0, r() * 6.28, 0); tmp.scale.set(rad, rad * 0.78, rad); tmp.updateMatrix(); crowns.setMatrixAt(i, tmp.matrix);
    crowns.setColorAt(i, col.set(pal[(r() * pal.length) | 0]));
  });
  trunks.castShadow = crowns.castShadow = true; crowns.receiveShadow = true;
  const pT = new THREE.CylinderGeometry(0.16, 0.24, 7, 6); pT.translate(0, 3.5, 0);
  const pC = new THREE.ConeGeometry(2.6, 1.3, 9, 1, true); pC.rotateX(Math.PI); pC.translate(0, 7.1, 0);
  const pTr = new THREE.InstancedMesh(pT, new THREE.MeshStandardMaterial({ color: '#8a7a66', roughness: 0.9 }), palms.length);
  const pCr = new THREE.InstancedMesh(pC, new THREE.MeshStandardMaterial({ color: '#4f7a34', roughness: 0.8, flatShading: true, side: THREE.DoubleSide }), palms.length);
  palms.forEach(([x, y], i) => { const s = 0.85 + r() * 0.3; tmp.position.copy(at(x, y)); tmp.rotation.set(0, r() * 6.28, 0); tmp.scale.set(s, s, s); tmp.updateMatrix(); pTr.setMatrixAt(i, tmp.matrix); pCr.setMatrixAt(i, tmp.matrix); });
  pTr.castShadow = pCr.castShadow = true;
  const bG = new THREE.IcosahedronGeometry(1, 1);
  const bM = new THREE.InstancedMesh(bG, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85 }), bushes.length);
  const bp = ['#4f7f36','#5c8c3c','#3f6c2c','#6d8f3f','#8a9a3a'];
  bushes.forEach(([x, y], i) => { const s = 0.5 + r() * 0.5; tmp.position.copy(at(x, y, s * 0.6)); tmp.rotation.set(0, 0, 0); tmp.scale.set(s, s * 0.8, s); tmp.updateMatrix(); bM.setMatrixAt(i, tmp.matrix); bM.setColorAt(i, col.set(bp[(r() * bp.length) | 0])); });
  bM.castShadow = true;
  const gGrp = new THREE.Group(); gGrp.name = 'campus-trees'; gGrp.add(trunks, crowns, pTr, pCr, bM); world.add(gGrp);
}

/* ---------- build everything ---------- */
function build(){
  const res = HD ? 8192 : EXPORT ? 2048 : (LOW ? 2048 : 4096);
  const gTex = canvasTex(paintGround(res)); gTex.wrapS = gTex.wrapT = THREE.ClampToEdgeWrapping;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(GR.size, GR.size), new THREE.MeshStandardMaterial({ map: gTex, roughness: 0.96 }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(GR.x0 + GR.size / 2, 0, GR.z0 + GR.size / 2); ground.receiveShadow = true; ground.name = 'ground';
  world.add(ground);
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ color: PALETTE.floor, roughness: 1 }));
  outer.rotation.x = -Math.PI / 2; outer.position.y = -0.05; outer.receiveShadow = true;
  // Ground layers 2–5 cm apart z-fight on phone GPUs seen from 300+ m (the campus flickered in bands with the dark outer grass).
  // The outer grass and the road strips are always drawn first and never write depth, so the painted ground simply covers them.
  outer.material.depthWrite = false; outer.renderOrder = -2; scene.add(outer);
  // roads continue beyond the painted area (hidden under the painted ground inside it)
  [ROADS[0], ROADS[1], ROADS[2]].forEach(rd => { for (let i = 1; i < rd.pts.length; i++){
    const [ax, ay] = rd.pts[i - 1], [bx, by] = rd.pts[i]; const len = Math.hypot(bx - ax, by - ay) * S;
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(len, rd.w), new THREE.MeshStandardMaterial({ color: rd.c, roughness: 0.95 }));
    strip.rotation.set(-Math.PI / 2, 0, -Math.atan2(by - ay, bx - ax), 'YXZ'); strip.rotation.order = 'YXZ';
    strip.rotation.y = -Math.atan2(by - ay, bx - ax); strip.rotation.x = -Math.PI / 2; strip.rotation.z = 0;
    strip.position.set(wx((ax + bx) / 2), -0.02, wz((ay + by) / 2)); strip.receiveShadow = true;
    strip.material.depthWrite = false; strip.renderOrder = -1; scene.add(strip);
  } });
  BUILDINGS.forEach(building);
  addProps();
  addCampusGreen();
  if (!EXPORT) addForest();

  // registry: centres, sizes, labels
  for (const id of Object.keys(REG)){
    const R = REG[id], info = INFO[id];
    const rects = info && info.rect ? [info.rect] : R.boxes.map(b => b.rect);
    if (!rects.length) continue;
    const x0 = Math.min(...rects.map(r => r[0])), y0 = Math.min(...rects.map(r => r[1])), x1 = Math.max(...rects.map(r => r[2])), y1 = Math.max(...rects.map(r => r[3]));
    R.rect = [x0, y0, x1, y1];
    R.top = Math.max(3, ...R.boxes.map(b => b.top));
    R.center = new THREE.Vector3(wx((x0 + x1) / 2), 0, wz((y0 + y1) / 2));
    R.size = Math.max((x1 - x0) * S, (y1 - y0) * S);
    if (info && info.swatch) R.swatch = info.swatch;
    const text = R.label || (info && info.label);
    if (text){
      const el = document.createElement('button'); el.type = 'button'; el.className = 'lbl bld';
      el.innerHTML = '<i></i><span></span>'; el.querySelector('i').style.background = R.swatch || '#999'; el.querySelector('span').textContent = text;
      el.tabIndex = -1; el.setAttribute('aria-hidden', 'true');
      const o = new CSS2DObject(el); o.position.set(R.center.x, R.top + 2.5, R.center.z); scene.add(o); R.el = el;
    }
  }
}

  // ===== จบฉากจาก 21-school-map =====
  /* ---------- sun / time ---------- */
  const skyDay = { top: new THREE.Color('#5f9bd3'), hor: new THREE.Color('#dde8ec') }, skyWarm = { top: new THREE.Color('#6d8fc4'), hor: new THREE.Color('#f2d2ae') };
  function setTime(h){
    const t = (h - 6) / 12 * Math.PI, el = Math.sin(t);
    const dir = new THREE.Vector3(Math.cos(t), Math.max(0.07, el), 0.42).normalize();
    sun.position.copy(SUN_TARGET).addScaledVector(dir, 700);
    const warm = 1 - Math.min(1, el * 1.7);
    sun.color.setRGB(1, 0.94 - warm * 0.22, 0.86 - warm * 0.42);
    sun.intensity = 0.7 + 2.2 * Math.min(1, el * 1.5);
    hemi.intensity = 0.5 + 0.55 * Math.min(1, el * 1.6);
    skyU.top.value.copy(skyDay.top).lerp(skyWarm.top, warm * 0.8);
    skyU.hor.value.copy(skyDay.hor).lerp(skyWarm.hor, warm * 0.9);
    scene.fog.color.copy(skyU.hor.value);
  }

  /* ---------- camera views ---------- */
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const VIEWS = [
    { id: 'overview', name: 'ภาพรวม', pos: V(150, 175, 245), tgt: V(-40, 0, 10) },
    { id: 'gate', name: 'ทางเข้า', pos: V(wx(436), 2.8, wz(190)), tgt: V(wx(330), 2.2, wz(238)) },
    { id: 'main', name: 'อาคารเรียนหลัก', pos: V(wx(640), 42, wz(500)), tgt: V(wx(548), 5, wz(300)) },
    { id: 'rows', name: 'แถวอาคารเรียน', pos: V(wx(300), 34, wz(700)), tgt: V(wx(540), 5, wz(730)) },
    { id: 'sport', name: 'สนามกีฬา', pos: V(wx(400), 62, wz(470)), tgt: V(wx(211), 0, wz(560)) },
    { id: 'top', name: 'มุมบน', pos: V(-45, 560, 0.1), tgt: V(-45, 0, 0) },
  ];
  let fly = null;
  function flyTo(pos, tgt, dur = 1200){
    if (REDUCE){ camera.position.copy(pos); controls.target.copy(tgt); controls.update(); return; }
    fly = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos.clone(), t1: tgt.clone(), start: performance.now(), dur };
  }
  controls.addEventListener('start', () => { fly = null; opts.onUserMove?.(); });

  function focusOn(id){
    const R = REG[id]; if (!R || !R.center) return;
    const vf = camera.fov * Math.PI / 360, aspect = stage.clientWidth / Math.max(1, stage.clientHeight);
    const fit = Math.min(Math.tan(vf), Math.tan(vf) * aspect);
    const dist = Math.max(40, R.size * 0.62 / fit);
    const az = controls.getAzimuthalAngle();
    const tgt = R.center.clone(); tgt.y = Math.min(5, R.top * 0.35);
    const pos = tgt.clone().add(V(Math.sin(az) * dist * 0.8, dist * 0.62, Math.cos(az) * dist * 0.8));
    flyTo(pos, tgt);
  }

  /* =====================================================================
     ส่วนของแอป: เขตทำความสะอาด
     zone = { id, poly: [[px,py],...], color: '#hex', label, sub, mine, dim }
  ====================================================================== */
  const zoneGroup = new THREE.Group(); zoneGroup.name = 'zones'; scene.add(zoneGroup);
  const draftGroup = new THREE.Group(); draftGroup.name = 'draft'; scene.add(draftGroup);
  let zones = [], zoneMeshes = [], selectedZone = null, drawing = false;

  function disposeTree(o){
    o.traverse(n => {
      if (n.geometry) n.geometry.dispose();
      if (n.material) [].concat(n.material).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
      if (n.isCSS2DObject && n.element) n.element.remove();
    });
  }
  function clearGroup(g){ [...g.children].forEach(c => { disposeTree(c); g.remove(c); }); }

  function polyCenter(poly){
    // จุดกึ่งกลางพื้นที่ (centroid) — ถ้าตกนอกรูป ใช้จุดกึ่งกลางกรอบ
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++){
      const f = poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
      a += f; cx += (poly[j][0] + poly[i][0]) * f; cy += (poly[j][1] + poly[i][1]) * f;
    }
    if (Math.abs(a) > 1e-6){ cx /= 3 * a; cy /= 3 * a; if (inPoly(cx, cy, poly)) return [cx, cy]; }
    const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
    return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  }
  // ความสูงหลังคาสูงสุดของอาคารที่ตั้งอยู่ในเขต (ให้ป้ายลอยเหนืออาคาร)
  function roofIn(poly){
    let top = 0;
    for (const b of BUILDINGS){
      if (b.part === 'outside' || b.part === 'houses') continue;
      const [x0, y0, x1, y1] = b.rect, R = REG[b.part || b.id];
      const box = R && R.boxes.find(x => x.rect === b.rect);
      if (box && inPoly((x0 + x1) / 2, (y0 + y1) / 2, poly)) top = Math.max(top, box.top || 0);
    }
    return top;
  }

  function ribbon(poly, h){
    const pos = [];
    for (let i = 0; i < poly.length; i++){
      const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
      const A = [wx(ax), wz(ay)], B = [wx(bx), wz(by)];
      pos.push(A[0], 0, A[1], B[0], 0, B[1], B[0], h, B[1], A[0], 0, A[1], B[0], h, B[1], A[0], h, A[1]);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    // ไล่ความทึบจากพื้นขึ้นบน
    const al = []; for (let i = 0; i < pos.length; i += 3) al.push(pos[i + 1] > 0 ? 0 : 1);
    g.setAttribute('fade', new THREE.Float32BufferAttribute(al, 1));
    return g;
  }
  function ribbonMat(color, opacity){
    return new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(color) }, opacity: { value: opacity } },
      vertexShader: 'attribute float fade; varying float vF; void main(){ vF = fade; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 color; uniform float opacity; varying float vF; void main(){ gl_FragColor = vec4(color, opacity * (0.25 + 0.75 * vF)); }',
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
  }

  function renderZones(){
    clearGroup(zoneGroup); zoneMeshes = [];
    for (const z of zones){
      if (!z.poly || z.poly.length < 3) continue;
      const on = z.id === selectedZone, dim = z.dim && !on;
      const shape = new THREE.Shape(z.poly.map(([x, y]) => new THREE.Vector2(wx(x), -wz(y))));
      const fill = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({
        color: z.color, transparent: true, opacity: dim ? 0.12 : on ? 0.66 : 0.5, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      }));
      fill.rotation.x = -Math.PI / 2; fill.position.y = 0.12; fill.renderOrder = 2; fill.userData.zid = z.id;
      zoneGroup.add(fill); zoneMeshes.push(fill);
      const wall = new THREE.Mesh(ribbon(z.poly, on ? 4 : 2.4), ribbonMat(z.color, dim ? 0.15 : on ? 0.95 : 0.7));
      wall.renderOrder = 3; zoneGroup.add(wall);
      const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(z.poly.map(([x, y]) => new THREE.Vector3(wx(x), 0.2, wz(y)))),
        new THREE.LineBasicMaterial({ color: z.color, transparent: true, opacity: dim ? 0.3 : 1 }));
      zoneGroup.add(line);
      if (z.label){
        const [cx, cy] = polyCenter(z.poly);
        const el = document.createElement('button'); el.type = 'button';
        el.className = 'zlbl' + (on ? ' on' : '') + (z.mine ? ' mine' : '') + (dim ? ' dim' : '');
        el.innerHTML = '<i></i><b></b>';
        el.querySelector('i').style.background = z.color; el.querySelector('b').textContent = z.label;
        if (z.sub){ const s = document.createElement('small'); s.textContent = z.sub; el.append(s); }
        el.setAttribute('aria-label', z.aria || z.label);
        el.addEventListener('click', ev => { ev.stopPropagation(); if (!drawing) opts.onPick?.(z.id); });
        const o = new CSS2DObject(el); o.position.set(wx(cx), roofIn(z.poly) + 2.2, wz(cy)); o.renderOrder = on ? 10 : 1;
        zoneGroup.add(o);
      }
    }
  }

  let fitted = false;
  function setZones(list){
    zones = list || []; renderZones();
    if (!fitted && zones.some(z => z.poly && z.poly.length > 2)){ fitted = true; fitAll(false); }
  }
  // มุมมองเริ่มต้น: เห็นทุกเขตพอดีจอ มองเฉียงจากทิศใต้ค่อนไปทางตะวันออก
  function fitAll(animate = true){
    const pts = zones.flatMap(z => z.poly || []); if (!pts.length) return false;
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    // อย่างน้อย ~140×100 ม. — จุดเวรจุดเดียว (แผ่นเล็ก) จะไม่ซูมจนเห็นแต่พื้น
    const w = Math.max((x1 - x0) * S, 140), h = Math.max((y1 - y0) * S, 100);
    const vf = camera.fov * Math.PI / 360, aspect = stage.clientWidth / Math.max(1, stage.clientHeight);
    const dist = Math.max(h * 0.62 / Math.tan(vf), w * 0.62 / (Math.tan(vf) * aspect));
    const tgt = new THREE.Vector3(wx((x0 + x1) / 2), 0, wz((y0 + y1) / 2) + h * 0.06);
    const pos = tgt.clone().add(new THREE.Vector3(dist * 0.18, dist * 0.86, dist * 0.48));
    if (animate) flyTo(pos, tgt); else { camera.position.copy(pos); controls.target.copy(tgt); controls.update(); }
    return true;
  }
  function selectZone(id, fly = true){
    selectedZone = id; renderZones();
    const z = zones.find(x => x.id === id);
    if (fly && z && z.poly && z.poly.length) focusPoly(z.poly);
  }
  function focusPoly(poly){
    const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const size = Math.max((x1 - x0) * S, (y1 - y0) * S, 30);
    const vf = camera.fov * Math.PI / 360, aspect = stage.clientWidth / Math.max(1, stage.clientHeight);
    const fit = Math.min(Math.tan(vf), Math.tan(vf) * aspect);
    const dist = Math.max(45, size * 0.7 / fit);
    const az = controls.getAzimuthalAngle();
    const tgt = new THREE.Vector3(wx((x0 + x1) / 2), 0, wz((y0 + y1) / 2));
    flyTo(tgt.clone().add(new THREE.Vector3(Math.sin(az) * dist * 0.72, dist * 0.7, Math.cos(az) * dist * 0.72)), tgt);
  }
  function setView(id){ if (id === 'overview' && fitAll()) return; const v = VIEWS.find(x => x.id === id) || VIEWS[0]; flyTo(v.pos, v.tgt); }
  function setLabels(o){
    labelRenderer.domElement.classList.toggle('no-bld', !o.buildings);
    labelRenderer.domElement.classList.toggle('no-zone', o.zones === false);
  }

  /* โหมดวาดเขต: แตะพื้นเพื่อเพิ่มจุด (พิกัดพิกเซลดาวเทียม) */
  function setDrawing(on){ drawing = !!on; stage.classList.toggle('drawing', drawing); if (!drawing) setDraft([]); }
  function setDraft(points){
    clearGroup(draftGroup);
    if (!points || !points.length) return;
    const v = points.map(([x, y]) => new THREE.Vector3(wx(x), 0.35, wz(y)));
    const lineGeo = new THREE.BufferGeometry().setFromPoints(points.length > 2 ? [...v, v[0]] : v);
    draftGroup.add(new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: '#8f1036', depthTest: false })));
    if (points.length > 2){
      const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(wx(x), -wz(y))));
      const f = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: '#8f1036', transparent: true, opacity: 0.25, depthWrite: false, depthTest: false }));
      f.rotation.x = -Math.PI / 2; f.position.y = 0.3; draftGroup.add(f);
    }
    const dotGeo = new THREE.CylinderGeometry(0.9, 0.9, 0.5, 16);
    v.forEach((p, i) => {
      const d = new THREE.Mesh(i ? dotGeo : dotGeo.clone(), new THREE.MeshBasicMaterial({ color: i ? '#8f1036' : '#d4a017', depthTest: false }));
      d.position.copy(p); d.renderOrder = 20; draftGroup.add(d);
    });
  }

  /* เลือกเขตด้วยการแตะ: ยิง ray ไปที่พื้นเขต/อาคาร แล้วหาว่าจุดนั้นอยู่ในเขตไหน */
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  let down = null;
  const onDown = e => { down = [e.clientX, e.clientY]; };
  const onUp = e => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (drawing){
      const p = new THREE.Vector3();
      if (ray.ray.intersectPlane(groundPlane, p)) opts.onDrawPoint?.([Math.round(p.x / S + OX), Math.round(p.z / S + OY)]);
      return;
    }
    const hit = ray.intersectObjects([...zoneMeshes, ...pickables], false)[0];
    let id = null;
    if (hit){
      const px = hit.point.x / S + OX, py = hit.point.z / S + OY;
      const z = zones.find(z => z.poly && z.poly.length > 2 && inPoly(px, py, z.poly));
      if (z) id = z.id;
    }
    opts.onPick?.(id);
  };
  renderer.domElement.addEventListener('pointerdown', onDown);
  renderer.domElement.addEventListener('pointerup', onUp);

  /* ขนาด + วนวาด (หยุดวาดเมื่อแท็บถูกซ่อน) */
  function resize(){
    const w = stage.clientWidth, h = stage.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); labelRenderer.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize); ro.observe(stage);
  let raf = 0, dead = false;
  function frame(now){
    if (dead) return;
    if (fly){ const k = Math.min(1, (now - fly.start) / fly.dur); const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; camera.position.lerpVectors(fly.p0, fly.p1, e); controls.target.lerpVectors(fly.t0, fly.t1, e); if (k === 1) fly = null; }
    controls.update();
    opts.onHeading?.(controls.getAzimuthalAngle());
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }

  build();
  setTime(10.5);
  camera.position.copy(VIEWS[0].pos); controls.target.copy(VIEWS[0].tgt);
  resize(); controls.update();
  raf = requestAnimationFrame(frame);

  function northUp(){
    const off = camera.position.clone().sub(controls.target); const flat = Math.hypot(off.x, off.z);
    flyTo(controls.target.clone().add(new THREE.Vector3(0, off.y, Math.max(flat, 0.1))), controls.target.clone(), 800);
  }
  function dispose(){
    dead = true; cancelAnimationFrame(raf); ro.disconnect(); controls.dispose();
    renderer.domElement.removeEventListener('pointerdown', onDown);
    renderer.domElement.removeEventListener('pointerup', onUp);
    disposeTree(scene);
    renderer.dispose(); renderer.forceContextLoss();
    renderer.domElement.remove(); labelRenderer.domElement.remove();
  }

  return { setZones, selectZone, focusPoly, setView, setLabels, setDrawing, setDraft, setTime, northUp, dispose,
    views: VIEWS.filter(v => v.id === 'overview' || v.id === 'top').map(v => ({ id: v.id, name: v.name })) };
}
