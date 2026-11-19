import { lazy, Suspense, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { errText, isConfigured, ROLE_LABEL, SCHOOL_DOMAIN, supabase, type Profile } from "./lib/supabase";
import { Field, Modal } from "./components/ui";
import { APP_NAME, initials, LOGO, SCHOOL_NAME } from "./lib/brand";
import { Mark } from "./components/Mark";
import { LineLink } from "./components/LineLink";
import { CarFront, House, LogOut, Presentation, Settings, Toilet, UserPen, type LucideIcon } from "lucide-react";
import { navigate, usePath } from "./lib/router";
import { MeContext } from "./lib/me";
import Home from "./pages/Home";

const Rooms = lazy(() => import("./pages/Rooms"));
const Vehicles = lazy(() => import("./pages/Vehicles"));
const VehiclePrint = lazy(() => import("./pages/VehiclePrint"));
const Toilets = lazy(() => import("./pages/Toilets"));
const Inspect = lazy(() => import("./pages/Inspect"));
const Admin = lazy(() => import("./pages/Admin"));

type NavItem = { path: string; label: string; long: string; icon: LucideIcon; show?: (p: Profile) => boolean };
const NAV: NavItem[] = [
  { path: "/", label: "หน้าแรก", long: "หน้าแรก", icon: House },
  { path: "/rooms", label: "ห้องประชุม", long: "จองห้องประชุม", icon: Presentation },
  { path: "/vehicles", label: "รถ", long: "ขอใช้รถไปราชการ", icon: CarFront },
  { path: "/toilets", label: "ห้องน้ำ", long: "ตรวจห้องน้ำ (HAS)", icon: Toilet },
  { path: "/admin", label: "จัดการ", long: "จัดการระบบ", icon: Settings, show: (p) => p.role === "admin" },
];

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [me, setMe] = useState<Profile | null | undefined>(undefined);
  const [loadErr, setLoadErr] = useState(false);
  const [editProfile, setEditProfile] = useState(false);
  const [account, setAccount] = useState(false);
  const path = usePath();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const uid = session?.user.id;
  useEffect(() => {
    if (!uid) return;
    let alive = true;
    supabase.from("profiles").select("id,email,full_name,role,line_linked,position").eq("id", uid).maybeSingle()
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) setLoadErr(true); // เน็ตหลุด/เซิร์ฟเวอร์มีปัญหา — อย่าบอกว่าไม่ใช่บุคลากร
        else setMe((data as Profile | null) ?? null);
      });
    return () => { alive = false; };
  }, [uid]);

  if (!isConfigured) return <Center><h2>ยังไม่ได้ตั้งค่า</h2><p className="muted">ตั้ง env <code>VITE_SUPABASE_URL</code> และ <code>VITE_SUPABASE_KEY</code> แล้ว build ใหม่</p></Center>;
  if (loadErr) return <Center><div className="center-text"><p>โหลดข้อมูลผู้ใช้ไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่</p><button className="btn" onClick={() => window.location.reload()}>ลองใหม่</button></div></Center>;
  if (session === undefined || (session && me === undefined)) return <Center><div className="spinner" /></Center>;
  if (!session) return <Login />;
  if (!me) return <NotStaff email={session.user.email ?? ""} />;

  const nav = NAV.filter((n) => !n.show || n.show(me));
  const active = (p: string) => (p === "/" ? path === "/" : path.startsWith(p));
  let page;
  const openProfile = () => setEditProfile(true);
  if (path.startsWith("/t/")) page = <Inspect token={path.slice(3)} />;
  else if (path.startsWith("/rooms")) page = <Rooms />;
  else if (/^\/vehicles\/print\/\d+$/.test(path)) page = <VehiclePrint id={Number(path.split("/").pop())} />;
  else if (path.startsWith("/vehicles")) page = <Vehicles />;
  else if (path.startsWith("/toilets")) page = <Toilets />;
  else if (path.startsWith("/admin") && me.role === "admin") page = <Admin />;
  else page = <Home onEditProfile={openProfile} />;

  const signOut = () => supabase.auth.signOut();
  const onLinked = (linked: boolean) => setMe((m) => (m ? { ...m, line_linked: linked } : m));
  const go = (p: string) => { setAccount(false); navigate(p); };

  return (
    <MeContext.Provider value={me}>
      <div className="shell">
        {/* คอมพิวเตอร์: แถบข้าง */}
        <aside className="sidebar">
          <button className="side-brand" onClick={() => go("/")}>
            <span className="seal" style={{ width: 76, height: 76 }}><img src={LOGO} alt={`ตรา${SCHOOL_NAME}`} /></span>
            <b>{APP_NAME}</b><span>{SCHOOL_NAME}</span>
          </button>
          <nav className="sidenav" aria-label="เมนูหลัก">
            {nav.map((n) => (
              <button key={n.path} className={active(n.path) ? "on" : ""} aria-current={active(n.path) ? "page" : undefined} onClick={() => go(n.path)}>
                <n.icon size={19} />{n.long}
              </button>
            ))}
          </nav>
          <div className="me-card">
            <div className="me-row">
              <span className="avatar" aria-hidden>{initials(me.full_name, me.email)}</span>
              <span className="me-name"><b>{me.full_name || me.email}</b><span>{ROLE_LABEL[me.role]}</span></span>
            </div>
            <div className="me-actions">
              <button className="btn" onClick={openProfile}><UserPen size={16} />ข้อมูลของฉัน</button>
              <button className="btn" onClick={signOut} title="ออกจากระบบ"><LogOut size={16} />ออก</button>
            </div>
          </div>
        </aside>

        {/* มือถือ: แถบบน */}
        <header className="appbar">
          <button className="brand" onClick={() => go("/")}>
            <Mark size={34} className="mark" />
            <span className="brand-text"><b>{APP_NAME}</b><span>{SCHOOL_NAME}</span></span>
          </button>
          <button className="avatar" onClick={() => setAccount(true)} aria-label="บัญชีของฉัน">{initials(me.full_name, me.email)}</button>
        </header>

        <main className="page">
          <Suspense fallback={<div className="spinner" />}>{page}</Suspense>
        </main>
      </div>

      <nav className="bottomnav" aria-label="เมนูหลัก">
        {nav.map((n) => (
          <button key={n.path} className={active(n.path) ? "on" : ""} aria-current={active(n.path) ? "page" : undefined} onClick={() => go(n.path)}>
            <n.icon size={22} strokeWidth={active(n.path) ? 2.4 : 1.9} />{n.label}
          </button>
        ))}
      </nav>

      {account && (
        <Modal title="บัญชีของฉัน" onClose={() => setAccount(false)}>
          <div className="form">
            <div className="me-row">
              <span className="avatar" aria-hidden>{initials(me.full_name, me.email)}</span>
              <span className="me-name"><b>{me.full_name || "ยังไม่ได้ตั้งชื่อ"}</b><span>{me.position ? `${me.position} · ` : ""}{ROLE_LABEL[me.role]}</span></span>
            </div>
            <p className="muted small">{me.email}</p>
            <button className="btn big" onClick={() => { setAccount(false); openProfile(); }}><UserPen size={18} />แก้ไขชื่อและตำแหน่ง</button>
            <button className="btn big danger" onClick={signOut}><LogOut size={18} />ออกจากระบบ</button>
          </div>
        </Modal>
      )}
      {editProfile && <ProfileForm me={me} onClose={() => setEditProfile(false)} onSaved={(p) => { setMe(p); setEditProfile(false); }} onLinked={onLinked} />}
    </MeContext.Provider>
  );
}

/** ชื่อ-นามสกุล (มีคำนำหน้า) และตำแหน่ง ใช้พิมพ์ในคำสั่งไปราชการ */
function ProfileForm({ me, onClose, onSaved, onLinked }: { me: Profile; onClose: () => void; onSaved: (p: Profile) => void; onLinked: (linked: boolean) => void }) {
  const [fullName, setFullName] = useState(me.full_name);
  const [position, setPosition] = useState(me.position ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setErr("");
    const patch = { full_name: fullName.trim(), position: position.trim() || null };
    const { error } = await supabase.from("profiles").update(patch).eq("id", me.id);
    setSaving(false);
    if (error) setErr(errText(error)); else onSaved({ ...me, ...patch });
  };
  return (
    <Modal title="ข้อมูลของฉัน" onClose={onClose}>
      <form className="form" onSubmit={save}>
        <Field label="ชื่อ-นามสกุล (มีคำนำหน้า)" hint="ใช้พิมพ์ในคำสั่งไปราชการ เช่น นางสาววาสนา ศรียอด">
          <input id="pf-name" required maxLength={120} value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </Field>
        <Field label="ตำแหน่ง" hint="เช่น ครู, ครูชำนาญการพิเศษ, ผู้อำนวยการโรงเรียน">
          <input id="pf-position" maxLength={120} value={position} onChange={(e) => setPosition(e.target.value)} />
        </Field>
        {err && <p className="error">{err}</p>}
        <button className="btn primary big" disabled={saving}>{saving ? "กำลังบันทึก…" : "บันทึกชื่อและตำแหน่ง"}</button>
      </form>
      <LineLink userId={me.id} linked={me.line_linked} onChange={onLinked} />
    </Modal>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="center">{children}</div>;
}

function Login() {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const signIn = async () => {
    setErr(""); setBusy(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      // กลับมาหน้าเดิม (เช่นสแกน QR ห้องน้ำแล้วต้องล็อกอินก่อน)
      options: { redirectTo: window.location.href, queryParams: { hd: SCHOOL_DOMAIN, prompt: "select_account" } },
    });
    if (error) { setErr(error.message); setBusy(false); }
  };
  return (
    <div className="login-wrap">
      <Mark className="mark-bg" />
      <div className="login">
        <span className="seal"><img src={LOGO} alt={`ตรา${SCHOOL_NAME}`} /></span>
        <h1>{APP_NAME}</h1>
        <div className="school">{SCHOOL_NAME}</div>
        <p className="lead">จองห้องประชุม ขอใช้รถไปราชการ และบันทึกผลตรวจห้องน้ำ ในที่เดียว</p>
        <button className="btn primary big" onClick={signIn} disabled={busy}>
          <span className="g" aria-hidden><GoogleG /></span>{busy ? "กำลังไปหน้า Google…" : "เข้าสู่ระบบด้วย Google"}
        </button>
        <div className="login-foot">
          <p className="muted small">ใช้บัญชีอีเมล @{SCHOOL_DOMAIN} ของโรงเรียน</p>
        </div>
        {err && <p className="error">{err}</p>}
      </div>
    </div>
  );
}

function GoogleG() {
  return (
    <svg width="14" height="14" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function NotStaff({ email }: { email: string }) {
  return (
    <div className="login-wrap">
      <Mark className="mark-bg" />
      <div className="login">
        <span className="seal"><img src={LOGO} alt={`ตรา${SCHOOL_NAME}`} /></span>
        <h1>บัญชีนี้ใช้ระบบไม่ได้</h1>
        <p><b>{email}</b> ไม่ใช่อีเมลของโรงเรียน</p>
        <p className="muted small">ออกจากระบบ แล้วเข้าใหม่ด้วยอีเมล @{SCHOOL_DOMAIN}</p>
        <button className="btn primary big" onClick={() => supabase.auth.signOut()}><LogOut size={18} />ออกจากระบบ</button>
      </div>
    </div>
  );
}
