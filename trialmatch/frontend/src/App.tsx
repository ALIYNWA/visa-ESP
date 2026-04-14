import { useState, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProtocolManager } from "@/pages/ProtocolManager";
import { PatientContextPage } from "@/pages/PatientContext";
import { AnalysisResult } from "@/pages/AnalysisResult";
import { Dashboard } from "@/pages/Dashboard";
import { AuditTrail } from "@/pages/AuditTrail";
import client from "@/api/client";
import type { CurrentUser } from "@/types";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

type Tab = "dashboard" | "analyses" | "patients" | "protocols" | "audit";

// ── Icons ─────────────────────────────────────────────────────────────────────
const Icons = {
  dashboard: (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
      <path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  analyses: (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
      <path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  patients: (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  protocols: (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
      <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  logout: (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
      <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  audit: (
    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
      <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  logo: (
    <svg width="22" height="22" fill="none" viewBox="0 0 24 24">
      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="#818cf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
};

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  investigateur_principal: "Investigateur",
  co_investigateur: "Co-investigateur",
  arc: "ARC",
  tec: "TEC",
};

// ── Login Page ─────────────────────────────────────────────────────────────────
function LoginPage({ onLogin }: { onLogin: (user: CurrentUser) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // ── Mode démo (sans backend) ──────────────────────────────────────────────
  const DEMO_USERS: Record<string, CurrentUser> = {
    "admin":         { id: "00000000-0000-0000-0000-000000000001", username: "admin",         email: "admin@hopital.fr",   role: "admin",                   is_active: true, last_login: null },
    "investigateur": { id: "00000000-0000-0000-0000-000000000002", username: "investigateur", email: "invest@hopital.fr",  role: "investigateur_principal", is_active: true, last_login: null },
    "arc":           { id: "00000000-0000-0000-0000-000000000003", username: "arc",           email: "arc@hopital.fr",     role: "arc",                     is_active: true, last_login: null },
    "tec":           { id: "00000000-0000-0000-0000-000000000004", username: "tec",           email: "tec@hopital.fr",     role: "tec",                     is_active: true, last_login: null },
  };

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    // Mode démo : identifiants prédéfinis, pas de backend requis
    const demoUser = DEMO_USERS[username.toLowerCase()];
    if (demoUser && password === "demo") {
      await new Promise(r => setTimeout(r, 600)); // simulation latence
      localStorage.setItem("access_token", "demo-token");
      localStorage.setItem("demo_user", JSON.stringify(demoUser));
      onLogin(demoUser);
      setLoading(false);
      return;
    }

    try {
      const resp = await client.post("/auth/login", { username, password });
      localStorage.setItem("access_token", resp.data.access_token);
      const me = await client.get<CurrentUser>("/auth/me");
      onLogin(me.data);
    } catch {
      setError("Identifiants incorrects. Veuillez réessayer.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center relative overflow-hidden"
      style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)" }}
    >
      {/* Background glow blobs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full opacity-10 blur-3xl pointer-events-none"
           style={{ background: "radial-gradient(circle, #6366f1, transparent)" }} />
      <div className="absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full opacity-10 blur-3xl pointer-events-none"
           style={{ background: "radial-gradient(circle, #8b5cf6, transparent)" }} />

      <div className="relative z-10 w-full max-w-sm px-6 fade-up">
        {/* Logo */}
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
               style={{ background: "linear-gradient(135deg, #6366f1, #4f46e5)" }}>
            {Icons.logo}
          </div>
          <span className="text-2xl font-bold tracking-tight" style={{ color: "#f1f5f9" }}>
            TrialMatch
          </span>
        </div>

        {/* Card */}
        <div className="glass rounded-2xl p-8" style={{ border: "1px solid rgba(99,102,241,0.2)" }}>
          <h2 className="text-lg font-semibold mb-1" style={{ color: "#f1f5f9" }}>Connexion</h2>
          <p className="text-sm mb-6" style={{ color: "#64748b" }}>
            Accès réservé au personnel autorisé
          </p>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "#94a3b8" }}>
                Identifiant
              </label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="nom.prenom"
                className="input-dark w-full rounded-xl px-4 py-2.5 text-sm"
                data-testid="login-username"
                autoComplete="username"
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "#94a3b8" }}>
                Mot de passe
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="input-dark w-full rounded-xl px-4 py-2.5 text-sm"
                data-testid="login-password"
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div className="rounded-lg px-4 py-2.5 text-sm flex items-center gap-2"
                   style={{ background: "rgba(244,63,94,0.1)", color: "#fb7185", border: "1px solid rgba(244,63,94,0.2)" }}>
                <span>⚠</span> {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-white mt-2"
              data-testid="login-submit"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
                  </svg>
                  Connexion…
                </span>
              ) : "Se connecter"}
            </button>
          </form>
        </div>

        {/* Comptes démo */}
        <div className="mt-4 rounded-xl p-4" style={{ background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.18)" }}>
          <p className="text-xs font-semibold mb-2.5" style={{ color: "#818cf8" }}>Mode démo — mot de passe : <code className="font-mono">demo</code></p>
          <div className="grid grid-cols-2 gap-1.5">
            {[
              { u: "admin",         r: "Admin" },
              { u: "investigateur", r: "Investigateur" },
              { u: "arc",           r: "ARC" },
              { u: "tec",           r: "TEC" },
            ].map(({ u, r }) => (
              <button key={u} onClick={() => { setUsername(u); setPassword("demo"); }}
                      className="text-left rounded-lg px-3 py-1.5 text-xs transition-colors"
                      style={{ background: "rgba(255,255,255,0.04)", color: "#94a3b8", border: "1px solid rgba(255,255,255,0.07)" }}>
                <span className="font-mono" style={{ color: "#f1f5f9" }}>{u}</span>
                <span className="ml-1.5" style={{ color: "#475569" }}>· {r}</span>
              </button>
            ))}
          </div>
        </div>

        <p className="text-center text-xs mt-3" style={{ color: "#1e293b" }}>
          Système on-premise · Données chiffrées AES-256
        </p>
      </div>
    </div>
  );
}

// ── App Shell ─────────────────────────────────────────────────────────────────
function AppShell({ user, onLogout }: { user: CurrentUser; onLogout: () => void }) {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");

  const canValidate = ["admin", "investigateur_principal"].includes(user.role);
  const canOverride = ["admin", "investigateur_principal", "co_investigateur"].includes(user.role);

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "dashboard", label: "Tableau de bord", icon: Icons.dashboard },
    { id: "analyses",  label: "Analyses",        icon: Icons.analyses },
    { id: "patients",  label: "Patients",        icon: Icons.patients },
    { id: "protocols", label: "Protocoles",      icon: Icons.protocols },
    { id: "audit",     label: "Audit",           icon: Icons.audit },
  ];

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "#0f172a" }}>

      {/* ── Sidebar ────────────────────────────────────────────────────────── */}
      <aside
        className="flex flex-col shrink-0 h-full"
        style={{
          width: "var(--sidebar-width)",
          background: "#0d1526",
          borderRight: "1px solid rgba(255,255,255,0.05)",
        }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-5 py-5" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
               style={{ background: "linear-gradient(135deg, #6366f1, #4f46e5)" }}>
            {Icons.logo}
          </div>
          <span className="font-bold text-base tracking-tight" style={{ color: "#f1f5f9" }}>TrialMatch</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          <p className="px-3 text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#334155" }}>
            Navigation
          </p>
          {tabs.map(tab => (
            <div
              key={tab.id}
              className={`nav-item ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="nav-icon shrink-0">{tab.icon}</span>
              {tab.label}
            </div>
          ))}
        </nav>

        {/* User */}
        <div className="px-3 py-4" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
               style={{ background: "rgba(255,255,255,0.03)" }}>
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                 style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)", color: "#fff" }}>
              {user.username[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate" style={{ color: "#f1f5f9" }}>{user.username}</p>
              <p className="text-xs truncate" style={{ color: "#475569" }}>{ROLE_LABELS[user.role] || user.role}</p>
            </div>
            <button
              onClick={onLogout}
              className="shrink-0 p-1.5 rounded-lg transition-colors hover:bg-white/10"
              style={{ color: "#475569" }}
              title="Déconnexion"
            >
              {Icons.logout}
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main ──────────────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="flex items-center justify-between px-8 py-4 shrink-0"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(15,23,42,0.8)", backdropFilter: "blur(8px)" }}>
          <div>
            <h1 className="text-lg font-semibold" style={{ color: "#f1f5f9" }}>
              {tabs.find(t => t.id === activeTab)?.label}
            </h1>
            <p className="text-xs" style={{ color: "#475569" }}>
              CHU · Système d'aide à l'éligibilité
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs px-2.5 py-1 rounded-full font-medium"
                  style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.25)" }}>
              Meditron 70B
            </span>
            <span className="text-xs px-2.5 py-1 rounded-full font-medium"
                  style={{ background: "rgba(16,185,129,0.12)", color: "#34d399", border: "1px solid rgba(16,185,129,0.2)" }}>
              ● En ligne
            </span>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-auto px-5 py-5 fade-up">
          {activeTab === "dashboard"  && <Dashboard />}
          {activeTab === "protocols" && <ProtocolManager />}
          {activeTab === "patients"  && <PatientContextPage />}
          {activeTab === "analyses"  && <AnalysisResult canValidate={canValidate} canOverride={canOverride} analystName={user.username} />}
          {activeTab === "audit"     && <AuditTrail />}
        </div>
      </main>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) { setLoading(false); return; }
    // Demo mode: restore user from localStorage without hitting the API
    if (token === "demo-token") {
      const stored = localStorage.getItem("demo_user");
      if (stored) {
        try { setUser(JSON.parse(stored)); } catch { localStorage.removeItem("access_token"); }
      } else {
        localStorage.removeItem("access_token");
      }
      setLoading(false);
      return;
    }
    client.get<CurrentUser>("/auth/me")
      .then(r => setUser(r.data))
      .catch(() => localStorage.removeItem("access_token"))
      .finally(() => setLoading(false));
  }, []);

  async function handleLogout() {
    if (localStorage.getItem("access_token") !== "demo-token") {
      await client.post("/auth/logout").catch(() => {});
    }
    localStorage.removeItem("access_token");
    localStorage.removeItem("demo_user");
    setUser(null);
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#0f172a" }}>
        <div className="flex items-center gap-3" style={{ color: "#475569" }}>
          <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
          </svg>
          <span className="text-sm">Chargement…</span>
        </div>
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      {user
        ? <AppShell user={user} onLogout={handleLogout} />
        : <LoginPage onLogin={setUser} />
      }
    </QueryClientProvider>
  );
}
