import Journey from "./Journey";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  Box,
  Check,
  ChevronRight,
  CircleHelp,
  Code2,
  Fingerprint,
  Globe2,
  KeyRound,
  Layers3,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Network,
  Play,
  RefreshCw,
  Search,
  Settings2,
  Shield,
  ShieldCheck,
  Terminal,
  Users,
  X,
} from "lucide-react";

type User = {
  name: string;
  provider: string;
  roles: string[];
  csrf: string;
  expires_at: number;
  created_at: number;
};
type Provider = { id: string; name: string };
type Project = {
  id: string;
  name: string;
  description: string;
  category: string;
  owner: string;
};
type Session = Omit<User, "csrf"> & { id: string };
type Event = {
  id: string;
  time: number;
  actor: string;
  action: string;
  outcome: string;
  provider: string;
};
type Rule = { method: string; path: string; roles: string[] };
type Page =
  | "Overview"
  | "How it works"
  | "Applications"
  | "Identity providers"
  | "Sessions"
  | "Access policies"
  | "Activity log";
const nav: { label: Page; icon: typeof Shield }[] = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "How it works", icon: Network },
  { label: "Applications", icon: Box },
  { label: "Identity providers", icon: Fingerprint },
  { label: "Sessions", icon: Users },
  { label: "Access policies", icon: ShieldCheck },
  { label: "Activity log", icon: Activity },
];
const hops = [
  {
    name: "Edge gateway",
    tech: "RHCL 1.5",
    icon: Globe2,
    detail:
      "Gateway API routes and Connectivity Link policies control incoming application traffic.",
  },
  {
    name: "Threat inspection",
    tech: "Coraza · WASM",
    icon: ShieldCheck,
    detail:
      "Coraza inspects requests at the gateway with the OWASP Core Rule Set. Available with the cluster deployment.",
  },
  {
    name: "Identity & access",
    tech: "Rust · Redis",
    icon: Fingerprint,
    detail:
      "The session manager validates the browser session and evaluates the role required for this exact method and path.",
  },
  {
    name: "Service waypoint",
    tech: "Service Mesh 3.5",
    icon: Network,
    detail:
      "The ambient mesh provides transport identity. A waypoint enforces Layer 7 policies before traffic reaches Quarkus.",
  },
  {
    name: "Your application",
    tech: "Quarkus · React",
    icon: Box,
    detail:
      "Quarkus serves protected business endpoints and checks the internal caller credential as defense in depth.",
  },
];
const date = (n: number) =>
  new Date(n * 1000).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export default function App() {
  const [page, setPage] = useState<Page>(
    window.location.hash === "#journey" ? "How it works" : "Overview",
  );
  const [user, setUser] = useState<User | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [mode, setMode] = useState("local");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [login, setLogin] = useState(false);
  const [hop, setHop] = useState(2);
  const [search, setSearch] = useState("");
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const admin = user?.roles.includes("admin");
  async function api<T>(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<T> {
    const response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(method !== "GET" ? { "X-CSRF-Token": user?.csrf || "" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      const data = await response
        .json()
        .catch(() => ({ error: `Request returned ${response.status}` }));
      if (response.status === 401) setUser(null);
      throw new Error(data.error || `Request returned ${response.status}`);
    }
    return response.status === 204 ? (undefined as T) : response.json();
  }
  async function refresh() {
    setError("");
    setLoading(true);
    try {
      const p = await api<{ providers: Provider[] }>("/auth/providers");
      setProviders(p.providers);
      const response = await fetch("/auth/me", { credentials: "same-origin" });
      if (response.status === 401) {
        setUser(null);
        setProjects([]);
        return;
      }
      if (!response.ok)
        throw new Error(
          "Session service is unavailable. Check the installation and try again.",
        );
      const me: User = await response.json();
      setUser(me);
      const [projects, policy, overview] = await Promise.all([
        api<Project[]>("/api/projects"),
        api<{ rules: Rule[] }>("/auth/policy"),
        api<{ mode: string }>("/api/overview"),
      ]);
      setProjects(projects);
      setRules(policy.rules);
      setMode(overview.mode);
      if (me.roles.includes("admin")) {
        const [s, e] = await Promise.all([
          api<{ sessions: Session[] }>("/auth/sessions"),
          api<{ events: Event[] }>("/auth/events"),
        ]);
        setSessions(s.sessions);
        setEvents(e.events);
      } else {
        setSessions([]);
        setEvents([]);
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to reach the application",
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  async function action(path: string, method = "GET", body?: unknown) {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ message?: string }>(path, method, body);
      setNotice(result?.message || "Action completed");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }
  function navigate(next: Page) {
    window.history.replaceState(
      null,
      "",
      next === "How it works" ? "#journey" : window.location.pathname,
    );
    setPage(next);
    setSearch("");
    setError("");
  }
  const signIn = (
    <button className="button primary" onClick={() => setLogin(true)}>
      <KeyRound size={16} /> Connect identity
    </button>
  );
  const gate = (children: ReactNode, needsAdmin = false) =>
    !user ? (
      <Empty
        icon={LockKeyhole}
        title="Your identity opens the gate"
        description="Connect an identity provider to explore live sessions, policies, and the protected application."
        action={signIn}
      />
    ) : needsAdmin && !admin ? (
      <Empty
        icon={Shield}
        title="Administrator access required"
        description="This view contains organization-wide session or audit information. Sign in with an administrator role to continue."
      />
    ) : (
      children
    );
  const filtered = projects.filter((p) =>
    `${p.name} ${p.description}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("Overview");
          }}
        >
          <img src="/favicon.png" alt="" />
          <span>
            Aegis<span>Gate</span>
          </span>
        </a>
        <div className="workspace">
          <div className="workspace-icon">
            <Layers3 size={18} />
          </div>
          <div>
            <strong>Security workspace</strong>
            <span>Application access demo</span>
          </div>
          <ChevronRight size={15} />
        </div>
        <div className="nav-caption">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {nav.map(({ label, icon: Icon }) => (
            <button
              key={label}
              aria-label={label}
              title={label}
              className={`nav-item ${page === label ? "selected" : ""}`}
              onClick={() => navigate(label)}
            >
              <Icon size={19} />
              <span>{label}</span>
              {label === "Applications" && user && (
                <small>{projects.length}</small>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="mesh-note">
            <div className="mesh-symbol">
              <Network size={22} />
            </div>
            <strong>Secure every hop.</strong>
            <p>
              Identity at the edge.
              <br />
              Trust throughout the mesh.
            </p>
            <button
              onClick={() => {
                navigate("How it works");
              }}
            >
              Explore the architecture <ChevronRight size={14} />
            </button>
          </div>
          <button
            className="help-link"
            onClick={() =>
              setNotice(
                "Start with scripts/install-local.sh. Cluster setup and demo scenarios are documented in the repository README.",
              )
            }
          >
            <CircleHelp size={17} /> Demo guide <span>↗</span>
          </button>
          <div className="sidebar-footer">
            <span className="tiny-logo">AG</span>
            <div>
              <strong>AegisGate demo</strong>
              <span>Built for zero trust</span>
            </div>
            <span className="version">v0.1</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight size={14} />
            <strong>{page}</strong>
          </div>
          <div className="topbar-right">
            <span className="environment">
              <Terminal size={14} />
              {user
                ? mode === "cluster"
                  ? "Cluster deployment"
                  : "Local development"
                : "Demo workspace"}
            </span>
            <div className="divider" />
            {user ? (
              <button
                className="account"
                onClick={() => void action("/auth/logout", "POST")}
                title="Sign out"
              >
                <span className="avatar">
                  {user.name
                    .split(" ")
                    .map((s) => s[0])
                    .slice(0, 2)
                    .join("")}
                </span>
                <span>{user.name}</span>
                <LogOut size={15} />
              </button>
            ) : (
              <button className="button small" onClick={() => setLogin(true)}>
                Sign in <KeyRound size={14} />
              </button>
            )}
          </div>
        </header>
        <main>
          {page !== "How it works" && (
            <div className="page-heading">
              <div>
                <div className="eyebrow">AEGISGATE CONTROL CENTER</div>
                <h1>
                  {page === "Overview" ? "Security, in the clear." : page}
                </h1>
                <p>
                  {
                    {
                      Overview:
                        "One view of your identities, applications, and every protected hop.",
                      "How it works":
                        "Follow a request through every layer of protection.",
                      Applications:
                        "Explore the business applications behind your access policies.",
                      "Identity providers":
                        "Bring your identities. Keep one consistent access policy.",
                      Sessions: "Manage access from sign-in to sign-out.",
                      "Access policies":
                        "Explicit permissions. Exact routes. Denied by default.",
                      "Activity log":
                        "Follow real access decisions across your application.",
                    }[page]
                  }
                </p>
              </div>
              <button
                className="button"
                onClick={() => void refresh()}
                disabled={loading}
              >
                <RefreshCw size={16} className={loading ? "spin" : ""} />{" "}
                Refresh
              </button>
            </div>
          )}
          {error && page !== "How it works" && (
            <div className="alert error" role="alert">
              <Shield size={18} />
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={17} />
              </button>
            </div>
          )}
          {notice && (
            <div className="alert success" role="status">
              <Check size={18} />
              <span>{notice}</span>
              <button
                aria-label="Dismiss notification"
                onClick={() => setNotice("")}
              >
                <X size={17} />
              </button>
            </div>
          )}
          {page === "How it works" && <Journey />}
          {page === "Overview" && (
            <>
              <section className="hero">
                <div className="hero-copy">
                  <span className="hero-label">
                    <ShieldCheck size={15} /> DEFENSE IN DEPTH
                  </span>
                  <h2>
                    Every request.
                    <br />
                    Every identity. <em>Protected.</em>
                  </h2>
                  <p>
                    A connected security architecture, from the first
                    <br className="desktop-break" /> handshake to your
                    application.
                  </p>
                  <button
                    className="button cyan"
                    onClick={() =>
                      user ? navigate("Applications") : setLogin(true)
                    }
                  >
                    {user ? <Box size={16} /> : <KeyRound size={16} />}{" "}
                    {user ? "Explore applications" : "Start a secure session"}
                  </button>
                </div>
                <div className="hero-art" aria-hidden="true">
                  <div className="orbit orbit-one" />
                  <div className="orbit orbit-two" />
                  <div className="orbit orbit-three" />
                  <div className="shield-core">
                    <ShieldCheck size={70} strokeWidth={1.2} />
                  </div>
                  <div className="satellite sat-one">
                    <Fingerprint size={23} />
                  </div>
                  <div className="satellite sat-two">
                    <Box size={23} />
                  </div>
                  <div className="satellite sat-three">
                    <LockKeyhole size={21} />
                  </div>
                  <span className="art-caption">IDENTITY · POLICY · TRUST</span>
                </div>
              </section>
              <div className="stats-grid">
                <Stat
                  title="Identity providers"
                  value={providers.length.toString()}
                  text="Configured OIDC connections"
                  icon={Fingerprint}
                  tone="blue"
                />
                <Stat
                  title="Your session"
                  value={user ? "Connected" : "Not signed in"}
                  text={
                    user
                      ? `Via ${user.provider}`
                      : "Connect to verify your access"
                  }
                  icon={KeyRound}
                  tone="teal"
                />
                <Stat
                  title="Access model"
                  value="Role-based"
                  text="Explicit grants · default deny"
                  icon={ShieldCheck}
                  tone="violet"
                />
                <Stat
                  title="Data plane"
                  value={mode === "cluster" ? "Ambient mesh" : "Local demo"}
                  text={
                    mode === "cluster"
                      ? "Cluster configuration · verify readiness"
                      : "Mesh & WAF require cluster install"
                  }
                  icon={Network}
                  tone="amber"
                />
              </div>
              <section className="panel architecture">
                <div className="panel-heading">
                  <div>
                    <h2>
                      Your request’s journey{" "}
                      <span className="badge subtle">Architecture</span>
                    </h2>
                    <p>
                      Five layers working together. Select a layer to explore.
                    </p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => navigate("How it works")}
                  >
                    Explore the full journey
                  </button>
                </div>
                <div className="hops">
                  {hops.map((h, i) => (
                    <button
                      key={h.name}
                      onClick={() => setHop(i)}
                      className={`hop ${hop === i ? "active" : ""}`}
                    >
                      <span className="hop-icon">
                        <h.icon size={23} />
                      </span>
                      <strong>{h.name}</strong>
                      <span>{h.tech}</span>
                      {i < 4 && (
                        <ChevronRight className="hop-chevron" size={18} />
                      )}
                    </button>
                  ))}
                </div>
                <div className="hop-detail">
                  <span className="detail-dot" />
                  <strong>{hops[hop].name}</strong>
                  <span>{hops[hop].detail}</span>
                </div>
              </section>
              <div className="bottom-grid">
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Identity connections</h2>
                    <button
                      className="text-button"
                      onClick={() => navigate("Identity providers")}
                    >
                      View providers <ChevronRight size={15} />
                    </button>
                  </div>
                  {providers.length ? (
                    providers.map((p) => (
                      <div className="provider-row" key={p.id}>
                        <div
                          className={`provider-logo ${p.id === "entra" ? "entra" : ""}`}
                        >
                          <KeyRound size={23} />
                        </div>
                        <div className="grow">
                          <strong>{p.name}</strong>
                          <span>
                            OpenID Connect · Authorization code + PKCE
                          </span>
                        </div>
                        <span className="badge">Configured</span>
                      </div>
                    ))
                  ) : (
                    <div className="inline-empty">
                      {loading
                        ? "Loading identity connections…"
                        : "Start the installation to connect Keycloak."}
                    </div>
                  )}
                  <div className="panel-foot">
                    <LockKeyhole size={14} /> Tokens stay server-side. Your
                    browser holds an opaque session.
                  </div>
                </section>
                <section className="panel session-card">
                  <div className="panel-heading">
                    <h2>
                      {user ? "Your access context" : "Ready when you are"}
                    </h2>
                    <Fingerprint size={19} />
                  </div>
                  {user ? (
                    <>
                      <div className="identity-name">
                        <span className="avatar large">{user.name[0]}</span>
                        <div>
                          <strong>{user.name}</strong>
                          <span>{user.provider}</span>
                        </div>
                      </div>
                      <div className="role-list">
                        {user.roles.map((r) => (
                          <span className="badge" key={r}>
                            {r}
                          </span>
                        ))}
                      </div>
                      <p className="session-expiry">
                        Expires {date(user.expires_at)}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="ready-text">
                        Sign in to see your roles, test protected routes, and
                        follow real access decisions.
                      </p>
                      {signIn}
                      <span className="session-hint">
                        Keycloak is provisioned during installation.
                      </span>
                    </>
                  )}
                </section>
              </div>
            </>
          )}
          {page === "Applications" &&
            gate(
              <>
                <div className="toolbar">
                  <div className="search">
                    <Search size={17} />
                    <input
                      aria-label="Search applications"
                      placeholder="Search applications…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  <span className="badge subtle">
                    Sample business data · live API
                  </span>
                </div>
                <div className="application-grid">
                  {filtered.map((p, i) => (
                    <section className="panel application-card" key={p.id}>
                      <div className={`app-icon color-${i}`}>
                        <Box size={27} />
                      </div>
                      <span className="app-category">{p.category}</span>
                      <h2>{p.name}</h2>
                      <p>{p.description}</p>
                      <div className="app-owner">
                        <Users size={15} />
                        {p.owner}
                      </div>
                      <button
                        className="button"
                        disabled={busy}
                        onClick={() =>
                          void action("/api/deployments", "POST", {
                            project: p.id,
                          })
                        }
                      >
                        <Play size={15} /> Test operator action
                      </button>
                    </section>
                  ))}
                </div>
                {!filtered.length && (
                  <Empty
                    icon={Search}
                    title="No applications found"
                    description="Try another search term."
                  />
                )}
                <div className="info-note">
                  <CircleHelp size={17} />
                  <span>
                    Operator actions require the <strong>operator</strong> or{" "}
                    <strong>admin</strong> role. A viewer receives a real 403
                    denial. These demo actions do not deploy workloads.
                  </span>
                </div>
                <section className="panel access-test">
                  <div>
                    <h2>Put your policy to the test</h2>
                    <p>
                      Call an administrator-only endpoint with your current
                      identity.
                    </p>
                  </div>
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => void action("/api/admin")}
                  >
                    <ShieldCheck size={16} /> Test admin access
                  </button>
                </section>
              </>,
            )}
          {page === "Identity providers" && (
            <>
              <div className="provider-grid">
                {providers.map((p) => (
                  <section className="panel provider-card" key={p.id}>
                    <div className="provider-card-top">
                      <div className="provider-logo">
                        <KeyRound size={28} />
                      </div>
                      <span className="badge">Configured</span>
                    </div>
                    <h2>{p.name}</h2>
                    <p>
                      Federated identity with a shared session and access
                      policy.
                    </p>
                    <dl>
                      <div>
                        <dt>Protocol</dt>
                        <dd>OpenID Connect</dd>
                      </div>
                      <div>
                        <dt>Flow</dt>
                        <dd>Code + PKCE</dd>
                      </div>
                      <div>
                        <dt>Role source</dt>
                        <dd>Verified ID token</dd>
                      </div>
                    </dl>
                    <button
                      className="button primary"
                      onClick={() =>
                        window.location.assign(`/auth/login/${p.id}`)
                      }
                    >
                      Sign in with {p.name}
                    </button>
                  </section>
                ))}
                <section className="panel provider-card optional">
                  <div className="provider-card-top">
                    <div className="provider-logo entra">
                      <Fingerprint size={28} />
                    </div>
                    <span className="badge subtle">Extensible</span>
                  </div>
                  <h2>Your next identity provider</h2>
                  <p>
                    Connect Microsoft Entra ID or another OIDC-compatible
                    provider.
                  </p>
                  <div className="integration-code">
                    <Code2 size={19} />
                    <span>Issuer + client + role mapping</span>
                  </div>
                  <p>
                    Provider adapters are configured in the session manager. The
                    repository includes an Entra ID template.
                  </p>
                  <button
                    className="button"
                    onClick={() =>
                      setNotice(
                        "Add provider-entra.example.json to config.providers, set ENTRA_CLIENT_SECRET, and restart the session manager. Register /auth/callback as the redirect URI.",
                      )
                    }
                  >
                    View configuration steps
                  </button>
                </section>
              </div>
            </>
          )}
          {page === "Sessions" &&
            gate(
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Active sessions</h2>
                    <p>Live Redis sessions · up to 500 results</p>
                  </div>
                  <span className="badge">{sessions.length} sessions</span>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Identity</th>
                        <th>Provider</th>
                        <th>Roles</th>
                        <th>Expires</th>
                        <th>
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sessions.map((s) => (
                        <tr key={s.id}>
                          <td>
                            <strong>{s.name}</strong>
                            <span className="table-sub">
                              Started {date(s.created_at)}
                            </span>
                          </td>
                          <td>{s.provider}</td>
                          <td>
                            <div className="role-list">
                              {s.roles.map((r) => (
                                <span className="badge subtle" key={r}>
                                  {r}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td>{date(s.expires_at)}</td>
                          <td>
                            <button
                              className="button danger small"
                              onClick={() => setRevokeId(s.id)}
                            >
                              Revoke
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!sessions.length && (
                  <div className="inline-empty">No active sessions.</div>
                )}
              </section>,
              true,
            )}
          {page === "Access policies" &&
            gate(
              <>
                <div className="policy-banner">
                  <div className="policy-icon">
                    <ShieldCheck size={28} />
                  </div>
                  <div>
                    <h2>Least privilege, by design.</h2>
                    <p>
                      Permissions come from mapped provider roles. Unlisted
                      methods and paths are denied.
                    </p>
                  </div>
                  <span className="badge">Default deny</span>
                </div>
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Application rules</h2>
                    <span className="quiet-tag">Evaluated by Rust</span>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Method</th>
                          <th>Exact path</th>
                          <th>Allowed roles</th>
                          <th>Decision</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rules.map((r) => (
                          <tr key={r.method + r.path}>
                            <td>
                              <span
                                className={`method ${r.method === "POST" ? "post" : ""}`}
                              >
                                {r.method}
                              </span>
                            </td>
                            <td>
                              <code>{r.path}</code>
                            </td>
                            <td>
                              <div className="role-list">
                                {r.roles.map((role) => (
                                  <span className="badge subtle" key={role}>
                                    {role}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td>
                              <span className="allow-text">
                                <Check size={14} /> Allow on match
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
                <div className="info-note">
                  <Settings2 size={18} />
                  <span>
                    Policy changes are managed in{" "}
                    <code>session-manager/config.json</code> and take effect
                    after restart.
                  </span>
                </div>
              </>,
            )}
          {page === "Activity log" &&
            gate(
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Access decisions</h2>
                    <p>
                      Recent application requests and session changes · up to
                      100 events
                    </p>
                  </div>
                  <span className="badge subtle">Live service data</span>
                </div>
                {events.length ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Action</th>
                          <th>Identity</th>
                          <th>Decision</th>
                          <th>Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {events.map((e) => (
                          <tr key={e.id}>
                            <td>
                              <code>{e.action}</code>
                            </td>
                            <td>
                              {e.actor}
                              <span className="table-sub">{e.provider}</span>
                            </td>
                            <td>
                              <span
                                className={`badge ${e.outcome === "denied" ? "denied" : ""}`}
                              >
                                {e.outcome}
                              </span>
                            </td>
                            <td>{date(e.time)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty
                    icon={Activity}
                    title="A clean slate"
                    description="Call a protected application endpoint to record your first access decision."
                  />
                )}
              </section>,
              true,
            )}
          <footer className="main-footer">
            <span>
              <Shield size={13} /> AegisGate · Secure every hop
            </span>
            <span>
              RHCL 1.5 <i /> Coraza WASM <i /> Service Mesh 3.5
            </span>
          </footer>
        </main>
      </div>
      {login && (
        <Modal title="Connect your identity" close={() => setLogin(false)}>
          <div className="modal-icon">
            <Fingerprint size={30} />
          </div>
          <p>
            Choose a provider to start a secure session. Your roles will be
            mapped automatically.
          </p>
          <div className="login-providers">
            {providers.map((p) => (
              <a className="button" key={p.id} href={`/auth/login/${p.id}`}>
                <KeyRound size={20} />
                <span>Continue with {p.name}</span>
                <ChevronRight size={16} />
              </a>
            ))}
          </div>
          {!providers.length && (
            <div className="alert error">
              No providers available. Start the local installation, then
              refresh.
            </div>
          )}
          <div className="modal-foot">
            <LockKeyhole size={14} /> Authorization code flow with PKCE
          </div>
        </Modal>
      )}
      {revokeId && (
        <Modal title="Revoke this session?" close={() => setRevokeId(null)}>
          <p>
            The next request using this session will be denied. The user must
            sign in again. Revoking your own session signs you out.
          </p>
          <button
            className="button danger"
            disabled={busy}
            onClick={() => {
              void action(`/auth/sessions/${revokeId}`, "DELETE");
              setRevokeId(null);
            }}
          >
            Revoke session
          </button>
        </Modal>
      )}
    </div>
  );
}
function Stat({
  title,
  value,
  text,
  icon: Icon,
  tone,
}: {
  title: string;
  value: string;
  text: string;
  icon: typeof Shield;
  tone: string;
}) {
  return (
    <section className="stat">
      <div className="stat-top">
        <span>{title}</span>
        <span className={`stat-icon ${tone}`}>
          <Icon size={18} />
        </span>
      </div>
      <strong>{value}</strong>
      <p>{text}</p>
    </section>
  );
}
function Empty({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: typeof Shield;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <section className="empty">
      <div className="empty-icon">
        <Icon size={29} />
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </section>
  );
}
function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="modal"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === dialog.current) {
          const box = dialog.current.getBoundingClientRect();
          if (
            e.clientX < box.left ||
            e.clientX > box.right ||
            e.clientY < box.top ||
            e.clientY > box.bottom
          )
            close();
        }
      }}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button autoFocus aria-label="Close dialog" onClick={close}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
