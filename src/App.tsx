import { lazy, Suspense, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { isConfigured, ROLE_LABEL, SCHOOL_DOMAIN, supabase, type Profile } from "./lib/supabase";
import { navigate, usePath } from "./lib/router";
import { MeContext } from "./lib/me";
import Home from "./pages/Home";

const Rooms = lazy(() => import("./pages/Rooms"));
const Vehicles = lazy(() => import("./pages/Vehicles"));
const VehiclePrint = lazy(() => import("./pages/VehiclePrint"));
const Toilets = lazy(() => import("./pages/Toilets"));
const Inspect = lazy(() => import("./pages/Inspect"));
const Admin = lazy(() => import("./pages/Admin"));

type NavItem = { path: string; label: string; icon: string; show?: (p: Profile) => boolean };
const NAV: NavItem[] = [
  { path: "/", label: "หน้าแรก", icon: "🏠" },
  { path: "/rooms", label: "ห้องประชุม", icon: "🏛️" },
  { path: "/vehicles", label: "จองรถ", icon: "🚐" },
  { path: "/toilets", label: "ห้องน้ำ", icon: "🚻" },
  { path: "/admin", label: "จัดการ", icon: "⚙️", show: (p) => p.role === "admin" },
];

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [me, setMe] = useState<Profile | null | undefined>(undefined);
  const [loadErr, setLoadErr] = useState(false);
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
    supabase.from("profiles").select("id,email,full_name,role,line_user_id").eq("id", uid).maybeSingle()
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) setLoadErr(true); // เน็ตหลุด/เซิร์ฟเวอร์มีปัญหา — อย่าบอกว่าไม่ใช่บุคลากร
        else setMe((data as Profile | null) ?? null);
      });
    return () => { alive = false; };
  }, [uid]);

  if (!isConfigured) return <Center><h2>ยังไม่ได้ตั้งค่า</h2><p className="muted">ตั้ง env <code>VITE_SUPABASE_URL</code> และ <code>VITE_SUPABASE_KEY</code> แล้ว build ใหม่</p></Center>;
  if (loadErr) return <Center><p>โหลดข้อมูลผู้ใช้ไม่สำเร็จ</p><button className="btn" onClick={() => window.location.reload()}>ลองใหม่</button></Center>;
  if (session === undefined || (session && me === undefined)) return <Center><div className="spinner" /></Center>;
  if (!session) return <Login />;
  if (!me) return <NotStaff email={session.user.email ?? ""} />;

  const nav = NAV.filter((n) => !n.show || n.show(me));
  const active = (p: string) => (p === "/" ? path === "/" : path.startsWith(p));
  let page;
  if (path.startsWith("/t/")) page = <Inspect token={path.slice(3)} />;
  else if (path.startsWith("/rooms")) page = <Rooms />;
  else if (/^\/vehicles\/print\/\d+$/.test(path)) page = <VehiclePrint id={Number(path.split("/").pop())} />;
  else if (path.startsWith("/vehicles")) page = <Vehicles />;
  else if (path.startsWith("/toilets")) page = <Toilets />;
  else if (path.startsWith("/admin") && me.role === "admin") page = <Admin />;
  else page = <Home />;

  return (
    <MeContext.Provider value={me}>
      <header className="topbar">
        <button className="brand" onClick={() => navigate("/")}>
          <img src="/icon.svg" alt="" width={28} height={28} />
          <span>งานบริหารทั่วไป</span>
        </button>
        <nav className="topnav">
          {nav.map((n) => (
            <button key={n.path} className={active(n.path) ? "on" : ""} onClick={() => navigate(n.path)}>{n.label}</button>
          ))}
        </nav>
        <div className="who">
          <span className="who-name">{me.full_name || me.email}</span>
          <span className="chip">{ROLE_LABEL[me.role]}</span>
          <button className="link" onClick={() => supabase.auth.signOut()}>ออก</button>
        </div>
      </header>
      <main className="page">
        <Suspense fallback={<div className="spinner" />}>{page}</Suspense>
      </main>
      <nav className="bottomnav">
        {nav.map((n) => (
          <button key={n.path} className={active(n.path) ? "on" : ""} onClick={() => navigate(n.path)}>
            <span aria-hidden>{n.icon}</span>{n.label}
          </button>
        ))}
      </nav>
    </MeContext.Provider>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="center">{children}</div>;
}

function Login() {
  const [err, setErr] = useState("");
  const signIn = async () => {
    setErr("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      // กลับมาหน้าเดิม (เช่นสแกน QR ห้องน้ำแล้วต้องล็อกอินก่อน)
      options: { redirectTo: window.location.href, queryParams: { hd: SCHOOL_DOMAIN, prompt: "select_account" } },
    });
    if (error) setErr(error.message);
  };
  return (
    <Center>
      <div className="card login">
        <img src="/icon.svg" alt="" width={64} height={64} />
        <h1>งานบริหารทั่วไป</h1>
        <p className="muted">โรงเรียนวังหลวงพิทยาสาร</p>
        <button className="btn primary big" onClick={signIn}>เข้าสู่ระบบด้วย Google</button>
        <p className="muted small">ใช้อีเมล @{SCHOOL_DOMAIN} เท่านั้น</p>
        {err && <p className="error">{err}</p>}
      </div>
    </Center>
  );
}

function NotStaff({ email }: { email: string }) {
  return (
    <Center>
      <div className="card login">
        <h2>ใช้งานไม่ได้</h2>
        <p>บัญชี <b>{email}</b> ไม่ใช่อีเมลของโรงเรียน</p>
        <p className="muted small">กรุณาออกแล้วเข้าใหม่ด้วยอีเมล @{SCHOOL_DOMAIN}</p>
        <button className="btn" onClick={() => supabase.auth.signOut()}>ออกจากระบบ</button>
      </div>
    </Center>
  );
}
