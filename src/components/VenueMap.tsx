import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { GEO_NOTE, mapsUrl, telHref, VENUE_CAT, venueLeft, type Venue } from "../lib/lodging";

/**
 * แผนที่จริงของที่พักรอบโรงเรียน (ภาพดาวเทียม Esri เป็นค่าเริ่มต้น สลับเป็นแผนที่ถนน OSM ได้) — lazy chunk แยก (leaflet ~45 KB)
 * หมุดเบอร์กันดี = โรงเรียนเรา · เขียว = รับแล้ว (ตัวเลข = ที่ว่าง) · เทา = ยังไม่ยืนยัน · ตำแหน่งโดยประมาณ = หมุดขอบประ
 * editable = ฝ่ายจัดห้องลากหมุดเพื่อแก้ตำแหน่ง (onMove)
 */
export default function VenueMap({ venues, selected, onSelect, editable = false, onMove }: {
  venues: Venue[]; selected: number | null; onSelect: (id: number | null) => void;
  editable?: boolean; onMove?: (id: number, lat: number, lng: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const markers = useRef(new Map<number, L.Marker>());
  const cb = useRef({ onSelect, onMove });
  useEffect(() => { cb.current = { onSelect, onMove }; }, [onSelect, onMove]);

  useEffect(() => {
    if (!box.current) return;
    const m = L.map(box.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false });
    // ค่าเริ่มต้น = ภาพดาวเทียม (Esri World Imagery) + ป้ายชื่อสถานที่ซ้อน · สลับเป็นแผนที่ถนน (OSM) ได้ที่มุมขวาบน
    const esri = "https://server.arcgisonline.com/ArcGIS/rest/services";
    const sat = L.layerGroup([
      L.tileLayer(`${esri}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, {
        maxZoom: 19, maxNativeZoom: 18, attribution: "ภาพดาวเทียม &copy; Esri, Maxar, Earthstar Geographics",
      }),
      L.tileLayer(`${esri}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 19, maxNativeZoom: 18 }),
    ]).addTo(m);
    const street = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
    });
    L.control.layers({ "ภาพดาวเทียม": sat, "แผนที่ถนน": street }, undefined, { position: "topright", collapsed: false }).addTo(m);
    m.on("click", () => cb.current.onSelect(null));
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    return () => { m.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const m = map.current, g = layer.current;
    if (!m || !g) return;
    g.clearLayers(); markers.current.clear();
    const pts: L.LatLngExpression[] = [];
    for (const v of venues) {
      if (v.lat == null || v.lng == null) continue;
      const left = venueLeft(v);
      const cls = v.is_home ? "home" : v.status === "confirmed" ? "ok" : v.status === "declined" ? "no" : "maybe";
      const approx = ["tambon", "village"].includes(v.geo_precision) ? " approx" : "";
      const label = v.is_home ? "วพ." : v.status === "confirmed" ? (left == null ? "✓" : String(left)) : "";
      const icon = L.divIcon({
        className: "", iconSize: v.is_home ? [40, 40] : v.status === "confirmed" ? [32, 32] : [16, 16],
        html: `<span class="vm-pin ${cls}${approx}">${label}</span>`,
      });
      const mk = L.marker([v.lat, v.lng], { icon, draggable: editable && !v.is_home, keyboard: true, title: v.name,
        zIndexOffset: v.is_home ? 1000 : v.status === "confirmed" ? 500 : 0 });
      mk.bindPopup(() => popup(v), { maxWidth: 260 });
      mk.on("click", () => cb.current.onSelect(v.id));
      mk.on("dragend", () => { const p = mk.getLatLng(); cb.current.onMove?.(v.id, p.lat, p.lng); });
      mk.addTo(g); markers.current.set(v.id, mk);
      pts.push([v.lat, v.lng]);
    }
    if (pts.length) m.fitBounds(L.latLngBounds(pts), { padding: [28, 28], maxZoom: 14 });
  }, [venues, editable]);

  useEffect(() => {
    const mk = selected != null ? markers.current.get(selected) : null;
    if (mk && map.current) { map.current.flyTo(mk.getLatLng(), Math.max(map.current.getZoom(), 13), { duration: .6 }); mk.openPopup(); }
  }, [selected]);

  return <div ref={box} className="venue-map" role="application" aria-label="แผนที่ที่พักรอบโรงเรียน ลากเพื่อเลื่อน ปุ่ม + − เพื่อซูม" />;
}

/** เนื้อหาในป้ายหมุด (สร้างด้วย DOM ไม่ใช้ innerHTML กับข้อมูลจาก DB) */
function popup(v: Venue): HTMLElement {
  const el = document.createElement("div"); el.className = "vm-pop";
  const add = (tag: string, text: string, cls?: string) => { const x = document.createElement(tag); x.textContent = text; if (cls) x.className = cls; el.append(x); return x; };
  add("b", v.name);
  add("small", [VENUE_CAT[v.category], v.distance_km != null && !v.is_home ? `${v.distance_km} กม.` : "", v.subdistrict && `ต.${v.subdistrict}`].filter(Boolean).join(" · "));
  if (v.capacity != null) add("span", v.is_home ? `รับได้ ${v.capacity} คน` : `รับได้ ${v.capacity} คน · ว่าง ${venueLeft(v)}`);
  if (v.contact) add("span", v.contact);
  for (const p of [v.phone1, v.phone2]) if (p) { const a = add("a", `โทร ${p}`); (a as HTMLAnchorElement).href = telHref(p); }
  const g = add("a", "นำทางด้วย Google Maps") as HTMLAnchorElement; g.href = mapsUrl(v); g.target = "_blank"; g.rel = "noreferrer";
  if (GEO_NOTE[v.geo_precision]) add("small", GEO_NOTE[v.geo_precision], "vm-approx");
  return el;
}
