import { useEffect, useState } from "react";
import {
  BookOpen,
  Box,
  Check,
  CheckCheck,
  ChevronRight,
  CircleHelp,
  Clock3,
  Cookie,
  Database,
  Fingerprint,
  Globe2,
  KeyRound,
  LockKeyhole,
  Monitor,
  Network,
  Pause,
  Play,
  Printer,
  RotateCcw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  SkipForward,
  SlidersHorizontal,
  UserRound,
  X,
} from "lucide-react";
import "./journey.css";

type NodeId =
  | "user"
  | "edge"
  | "waf"
  | "policy"
  | "rust"
  | "mesh"
  | "app"
  | "identity"
  | "redis";
type ScenarioId =
  "allowed" | "signin" | "attack" | "role" | "expired" | "bypass";
type Step = {
  node: NodeId;
  title: string;
  text: string;
  outcome?: "allow" | "deny" | "signin";
};
type Layer = {
  name: string;
  label: string;
  icon: typeof Shield;
  question: string;
  description: string;
  checks: string[];
  technical: string;
  color: string;
};
const layers: Record<NodeId, Layer> = {
  user: {
    name: "You & your browser",
    label: "React experience",
    icon: Monitor,
    question: "What would you like to do?",
    description:
      "You open an application, sign in, or choose an action. The browser sends the request and, after sign-in, an opaque session cookie.",
    checks: [
      "Your password goes to your identity provider.",
      "Identity-provider tokens are never exposed to React.",
    ],
    technical:
      "React uses same-origin /auth and /api endpoints. The cookie is HttpOnly and SameSite=Lax; HTTPS deployments also use Secure and the __Host- prefix.",
    color: "blue",
  },
  edge: {
    name: "Secure entrance",
    label: "HTTPS gateway",
    icon: Globe2,
    question: "Did you reach the right entrance?",
    description:
      "The gateway is the front door. It terminates HTTPS and directs the request to the correct route, keeping the backend off the public internet.",
    checks: [
      "HTTPS protects the connection from your browser.",
      "The application API routes to the Rust service.",
    ],
    technical:
      "An OpenShift passthrough Route reaches a Gateway API HTTPS listener. HTTPRoutes separate /auth, /api, and the React UI. Quarkus has no public route.",
    color: "cyan",
  },
  waf: {
    name: "Threat inspection",
    label: "Coraza WASM",
    icon: ShieldCheck,
    question: "Does this request look harmful?",
    description:
      "Coraza checks incoming requests for known attack patterns, such as script injection and SQL injection, before they reach application logic.",
    checks: [
      "Matching attacks are blocked at the gateway.",
      "Rules need tuning for the application.",
    ],
    technical:
      "Gateway-targeted WasmPlugin, AUTHN phase, OWASP Core Rule Set, and FAIL_CLOSE on fatal module failure. WAF inspection reduces risk; it cannot guarantee detection of every attack.",
    color: "cyan",
  },
  policy: {
    name: "Access checkpoint",
    label: "RHCL 1.5",
    icon: Shield,
    question: "May this session use this API?",
    description:
      "Connectivity Link asks the Rust session manager for an access decision. A request can continue only when its session and role permit the action.",
    checks: [
      "Rust remains the source of the RBAC decision.",
      "The sign-in routes stay available before authentication.",
    ],
    technical:
      "An AuthPolicy targets the /api HTTPRoute. Authorino sends the original cookie, method, and path to Rust /internal/check. Metadata caching is disabled. This is a decision call, not a second login.",
    color: "cyan",
  },
  rust: {
    name: "Session & permissions",
    label: "Rust session manager",
    icon: Fingerprint,
    question: "Who are you, and what may you do?",
    description:
      "Rust checks the Redis session and matches your role to the requested action. It checks again before forwarding the request, even after the gateway has allowed it.",
    checks: [
      "Unknown routes and ungranted actions are denied.",
      "Writes also require an origin and CSRF-token check.",
    ],
    technical:
      "Exact HTTP method/path rules map verified provider roles to viewer, operator, and admin. The BFF forwards only to the fixed Quarkus upstream, adds its internal credential, and ignores browser-supplied identity headers.",
    color: "violet",
  },
  mesh: {
    name: "Protected service hop",
    label: "Ambient mesh + waypoint",
    icon: Network,
    question: "Is this service allowed to reach the app?",
    description:
      "Inside the cluster, the mesh protects service-to-service traffic. The backend waypoint checks the calling service before allowing it through to the application.",
    checks: [
      "Ambient mTLS protects traffic between services.",
      "Backend policy requires the waypoint path.",
    ],
    technical:
      "Service Mesh 3.5 target: ztunnel provides L4 transport identity and mTLS. A Service-targeted waypoint policy allows the session-manager principal; backend L4 policy allows only the waypoint principal. No per-application sidecar is required.",
    color: "violet",
  },
  app: {
    name: "Protected application",
    label: "Quarkus backend",
    icon: Box,
    question: "Can the application fulfill your request?",
    description:
      "Quarkus receives a request that has passed the preceding checks. It verifies the internal caller credential and role again, then returns the business response.",
    checks: [
      "The backend independently checks the asserted role.",
      "The response travels back through the same service path.",
    ],
    technical:
      "Java 21 / Quarkus. REST endpoints validate the internal credential and allowed roles. The demo operator action returns a result; it does not deploy a workload.",
    color: "violet",
  },
  identity: {
    name: "Identity provider",
    label: "Keycloak · optional Entra ID",
    icon: KeyRound,
    question: "Can you prove who you are?",
    description:
      "Keycloak verifies your sign-in. Rust validates the signed identity result and maps the provider’s roles to the application’s permissions. Another OIDC provider can plug into the same flow.",
    checks: [
      "Keycloak is deployed during installation.",
      "Entra ID can be configured alongside it.",
    ],
    technical:
      "OIDC authorization code flow with PKCE S256, browser-bound one-use state, nonce, issuer, audience, signature, and expiry validation. Keycloak uses /realm_access/roles; Entra uses /roles from the verified ID token.",
    color: "blue",
  },
  redis: {
    name: "Shared session memory",
    label: "Redis",
    icon: Database,
    question: "Is this session still valid?",
    description:
      "Redis keeps the server-side session so every Rust instance sees the same identity, roles, and expiry. Removing a session makes its next access check fail.",
    checks: [
      "Idle and absolute timeouts limit session life.",
      "Logout and administrator revocation take effect on the next check.",
    ],
    technical:
      "Hashed opaque session IDs, Redis TTL for idle expiry, absolute expiry capped by the ID token, and atomic reads/TTL updates. Redis also stores temporary OIDC login state and the bounded demo audit log. Redis does not make RBAC decisions.",
    color: "violet",
  },
};
const common: Step[] = [
  {
    node: "user",
    title: "You open an application",
    text: "Your browser sends an API request with your existing session cookie.",
  },
  {
    node: "edge",
    title: "Enter through HTTPS",
    text: "The gateway accepts the encrypted connection and selects the application API route.",
  },
  {
    node: "waf",
    title: "Inspect the request",
    text: "This example contains no matching attack pattern, so Coraza allows inspection to complete.",
  },
];
const scenarios: Record<
  ScenarioId,
  {
    label: string;
    icon: typeof Shield;
    description: string;
    request: string;
    persona: string;
    result: string;
    steps: Step[];
  }
> = {
  allowed: {
    label: "Open application",
    icon: Box,
    description:
      "A signed-in viewer opens an application they are allowed to read.",
    request: "GET /api/projects",
    persona: "Viewer · valid session",
    result: "Your application responds",
    steps: [
      ...common,
      {
        node: "policy",
        title: "Ask for an access decision",
        text: "RHCL asks Rust to check the session and the permission required for this API.",
      },
      {
        node: "redis",
        title: "Find a valid session",
        text: "Rust reads Redis. The session exists, has not expired, and contains the mapped viewer role.",
      },
      {
        node: "rust",
        title: "Allow this exact action",
        text: "Rust allows GET /api/projects for viewers. Before proxying, it checks the session and permission again.",
      },
      {
        node: "mesh",
        title: "Verify the service identity",
        text: "The request crosses the ambient mesh. The backend waypoint accepts the session manager’s service identity.",
      },
      {
        node: "app",
        title: "Application access granted",
        text: "Quarkus verifies the internal caller and role, then returns the application list through the gateway to your browser.",
        outcome: "allow",
      },
    ],
  },
  signin: {
    label: "First sign-in",
    icon: Fingerprint,
    description:
      "A new visitor signs in before requesting a protected application.",
    request: "GET /auth/login/keycloak",
    persona: "New visitor · no session",
    result: "A secure session is created",
    steps: [
      {
        node: "user",
        title: "You choose “Sign in”",
        text: "The browser opens a public authentication route. You do not need an application session yet.",
      },
      {
        node: "edge",
        title: "Find the sign-in route",
        text: "The gateway routes /auth to Rust. The API AuthPolicy does not block the public sign-in and callback routes.",
      },
      {
        node: "waf",
        title: "Inspect the sign-in request",
        text: "The gateway’s WAF still inspects the request even though a session is not required.",
      },
      {
        node: "rust",
        title: "Prepare a protected login",
        text: "Rust stores short-lived login state in Redis, binds it to the browser, and redirects you to Keycloak with a PKCE challenge.",
      },
      {
        node: "identity",
        title: "Prove your identity",
        text: "You sign in with Keycloak. An optional Entra connection can provide the same OIDC flow. The browser returns a one-use authorization code to Rust through the gateway.",
      },
      {
        node: "rust",
        title: "Validate the identity result",
        text: "Rust exchanges the code and verifies the signature, issuer, audience, nonce, and expiry. It maps the signed provider roles to application roles.",
      },
      {
        node: "redis",
        title: "Save the application session",
        text: "Rust creates a new opaque session, stores its hashed identifier and session data in Redis, and sets expiry limits.",
      },
      {
        node: "user",
        title: "You are signed in",
        text: "The browser receives an HttpOnly session cookie and returns to the UI. Protected API requests can now follow the full access path.",
        outcome: "allow",
      },
    ],
  },
  attack: {
    label: "Malicious request",
    icon: ShieldAlert,
    description:
      "An illustrative injection attempt matches a configured WAF rule.",
    request: "GET /?q=<script>…</script>",
    persona: "Any visitor · malicious input",
    result: "The attack stops at the edge",
    steps: [
      {
        node: "user",
        title: "A harmful request is sent",
        text: "A visitor sends a request containing an example script-injection payload.",
      },
      {
        node: "edge",
        title: "Enter through HTTPS",
        text: "The gateway accepts the connection and selects the public page route. A session is not required for this route.",
      },
      {
        node: "waf",
        title: "Threat blocked",
        text: "A configured Coraza rule matches the attack and rejects the request, normally with HTTP 403. It never reaches Rust or Quarkus.",
        outcome: "deny",
      },
    ],
  },
  role: {
    label: "Insufficient role",
    icon: LockKeyhole,
    description:
      "A viewer tries an action reserved for operators and administrators.",
    request: "POST /api/deployments",
    persona: "Viewer · valid session",
    result: "Signed in does not mean allowed",
    steps: [
      {
        node: "user",
        title: "You try an operator action",
        text: "Your browser sends POST /api/deployments with your viewer session cookie.",
      },
      ...common.slice(1),
      {
        node: "policy",
        title: "Check the requested permission",
        text: "RHCL consults Rust about the POST /api/deployments action.",
      },
      {
        node: "redis",
        title: "The session is valid",
        text: "Redis confirms that the user is signed in as a viewer. Authentication alone does not grant permission.",
      },
      {
        node: "rust",
        title: "Permission denied",
        text: "Rust returns a deny decision because this action requires operator or admin. RHCL rejects it at the gateway. The backend is not called.",
        outcome: "deny",
      },
    ],
  },
  expired: {
    label: "Expired session",
    icon: Clock3,
    description:
      "A previously signed-in user returns after the session expires.",
    request: "GET /api/projects",
    persona: "Returning viewer · expired session",
    result: "Sign in again to continue",
    steps: [
      ...common,
      {
        node: "policy",
        title: "Check the session again",
        text: "A cookie is not proof that a session is still active. RHCL asks Rust for a fresh decision.",
      },
      {
        node: "redis",
        title: "The session is no longer valid",
        text: "The idle TTL has expired or the absolute limit has been reached. A removed or revoked session produces the same denial.",
      },
      {
        node: "rust",
        title: "Fresh sign-in required",
        text: "Rust returns a deny decision and the gateway blocks the API request. In local mode, the Rust API returns 401. The user must sign in again.",
        outcome: "signin",
      },
    ],
  },
  bypass: {
    label: "Direct backend access",
    icon: Network,
    description:
      "Another workload tries to reach Quarkus without the session-manager identity.",
    request: "Direct call to backend",
    persona: "Untrusted workload · wrong identity",
    result: "The service boundary holds",
    steps: [
      {
        node: "mesh",
        title: "An untrusted workload tries to enter",
        text: "This request bypasses the public entrance and attempts to reach the backend from inside the cluster.",
      },
      {
        node: "mesh",
        title: "Service identity denied",
        text: "The waypoint accepts only the session-manager identity, and the backend accepts only its waypoint. A direct attempt is rejected by the applicable mesh policy.",
        outcome: "deny",
      },
    ],
  },
};
const trunk: NodeId[] = [
  "user",
  "edge",
  "waf",
  "policy",
  "rust",
  "mesh",
  "app",
];
const scenarioIds = Object.keys(scenarios) as ScenarioId[];

export default function Journey() {
  const [scenario, setScenario] = useState<ScenarioId>("allowed");
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<NodeId>("user");
  const [playing, setPlaying] = useState(false);
  const [technical, setTechnical] = useState(false);
  const scene = scenarios[scenario];
  const step = scene.steps[cursor];
  const complete = cursor === scene.steps.length - 1;
  const visited = new Set(scene.steps.slice(0, cursor + 1).map((s) => s.node));
  const inspected = layers[selected];
  const InspectIcon = inspected.icon;
  useEffect(() => {
    if (!playing) return;
    if (complete) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => {
      const next = cursor + 1;
      setCursor(next);
      setSelected(scene.steps[next].node);
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [playing, complete, cursor, scene]);
  function choose(id: ScenarioId) {
    setScenario(id);
    setCursor(0);
    setSelected(scenarios[id].steps[0].node);
    setPlaying(false);
  }
  function move(index: number) {
    setCursor(index);
    setSelected(scene.steps[index].node);
    setPlaying(false);
  }
  function nodeButton(id: NodeId) {
    const layer = layers[id];
    const Icon = layer.icon;
    const blocked =
      step.node === id && step.outcome && step.outcome !== "allow";
    const seen = visited.has(id);
    const skipped =
      (scenario === "signin" &&
        (id === "policy" || id === "mesh" || id === "app")) ||
      (scenario === "bypass" && id !== "mesh");
    return (
      <button
        key={id}
        type="button"
        className={`journey-node ${layer.color} ${selected === id ? "inspected" : ""} ${step.node === id ? "current" : ""} ${seen ? "visited" : ""} ${blocked ? "blocked" : ""} ${skipped ? "unused" : ""}`}
        aria-pressed={selected === id}
        aria-label={`Explore ${layer.name}`}
        onClick={() => {
          setSelected(id);
          setPlaying(false);
        }}
      >
        <span className="jn-icon">
          <Icon size={26} strokeWidth={1.6} />
          {seen && step.node !== id && (
            <span className="jn-check">
              <Check size={10} />
            </span>
          )}
        </span>
        <strong>{layer.name}</strong>
        <span>{layer.label}</span>
        {step.node === id && (
          <span className="jn-state">
            {blocked ? "Stopped here" : complete ? "Completed" : "Current step"}
          </span>
        )}
      </button>
    );
  }
  return (
    <div className="journey-page">
      <section className="journey-intro">
        <div className="journey-intro-copy">
          <span className="journey-kicker">
            <BookOpen size={15} /> THE AEGISGATE JOURNEY
          </span>
          <h1>
            From your first click.
            <br />
            <em>To a protected application.</em>
          </h1>
          <p>
            Follow a request through every layer of protection.
            <br className="journey-wide-break" /> See who checks your identity,
            what stops an attack, and why trust is checked again.
          </p>
          <div className="journey-intro-tags">
            <span>
              <UserRound size={15} /> Simple for people
            </span>
            <span>
              <ShieldCheck size={15} /> Explicit about trust
            </span>
          </div>
        </div>
        <div className="journey-emblem" aria-hidden="true">
          <div className="je-ring" />
          <div className="je-orbit" />
          <div className="je-core">
            <ShieldCheck size={66} strokeWidth={1.1} />
          </div>
          <span className="je-device">
            <Monitor size={22} />
          </span>
          <span className="je-app">
            <Box size={22} />
          </span>
          <span className="je-caption">ONE REQUEST. EVERY LAYER.</span>
        </div>
      </section>
      <div className="journey-disclosure">
        <span>
          <span className="journey-simulation-mark" />
          <strong>Interactive architecture</strong>
          <span className="jd-secondary">
            Illustrative scenarios · no test traffic is sent
          </span>
        </span>
        <button className="journey-plain-button" onClick={() => window.print()}>
          <Printer size={16} /> Print guide
        </button>
      </div>
      <section
        className="journey-lab"
        aria-label="Interactive request walkthrough"
      >
        <div className="journey-section-title">
          <div>
            <span className="journey-overline">FOLLOW A REQUEST</span>
            <h2>What happens when…</h2>
          </div>
          <span className="journey-small-note">
            Choose a scenario to explore
          </span>
        </div>
        <div
          className="journey-scenarios"
          role="group"
          aria-label="Request scenarios"
        >
          {scenarioIds.map((id) => {
            const Icon = scenarios[id].icon;
            return (
              <button
                key={id}
                className={scenario === id ? "chosen" : ""}
                aria-pressed={scenario === id}
                onClick={() => choose(id)}
              >
                <Icon size={17} />
                {scenarios[id].label}
              </button>
            );
          })}
        </div>
        <div className="journey-request">
          <div className="journey-persona">
            <UserRound size={20} />
            <div>
              <strong>{scene.persona}</strong>
              <p>{scene.description}</p>
            </div>
          </div>
          <code>{scene.request}</code>
        </div>
        <div
          className="journey-map"
          aria-label="Application protection architecture"
        >
          <div className="journey-zone-labels">
            <span>
              <Monitor size={14} /> Your device
            </span>
            <span>
              <Globe2 size={14} /> At the edge <small>Public entrance</small>
            </span>
            <span>
              <LockKeyhole size={14} /> Application network{" "}
              <small>Service identity required</small>
            </span>
          </div>
          <div className="journey-trunk">{trunk.map(nodeButton)}</div>
          <div className="journey-branch-label">
            <span />
            <span>
              Rust works with your identity provider and shared session store
            </span>
            <span />
          </div>
          <div className="journey-support">
            <div className="journey-support-caption">
              <span className="journey-mini-line" />
              Supporting services
              <p>
                Sign in once.
                <br />
                Check access on every request.
              </p>
            </div>
            {(["identity", "redis"] as NodeId[]).map((id) => (
              <div key={id} className="journey-support-node">
                {nodeButton(id)}
                <p>
                  {id === "identity"
                    ? "Verifies your identity at sign-in."
                    : "Keeps your session until expiry or revocation."}
                </p>
              </div>
            ))}
          </div>
          <div className="journey-map-legend">
            <span>
              <i className="legend-current" />
              Current step
            </span>
            <span>
              <i className="legend-done" />
              Visited
            </span>
            <span>
              <i className="legend-stop" />
              Request stopped
            </span>
            <span className="journey-legend-hint">
              Select any layer for a closer look
            </span>
          </div>
        </div>
        <div
          className={`journey-player ${step.outcome === "deny" ? "denied" : step.outcome === "signin" ? "needs-signin" : complete ? "allowed" : ""}`}
        >
          <div className="journey-player-main">
            <span className="journey-player-icon">
              {step.outcome === "deny" ? (
                <ShieldAlert size={24} />
              ) : step.outcome === "signin" ? (
                <KeyRound size={24} />
              ) : complete ? (
                <CheckCheck size={24} />
              ) : (
                <ActivityGlyph />
              )}
            </span>
            <div aria-live="polite" aria-atomic="true">
              <span className="journey-progress-caption">
                {complete
                  ? "SCENARIO COMPLETE"
                  : `STEP ${cursor + 1} OF ${scene.steps.length}`}
              </span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </div>
          </div>
          <div className="journey-player-controls">
            <div className="journey-control-buttons">
              <button
                className="journey-play"
                onClick={() => {
                  if (playing) {
                    setPlaying(false);
                  } else {
                    if (complete) {
                      setCursor(0);
                      setSelected(scene.steps[0].node);
                    }
                    setPlaying(true);
                  }
                }}
              >
                {playing ? <Pause size={17} /> : <Play size={17} />}{" "}
                {playing ? "Pause" : complete ? "Replay" : "Follow request"}
              </button>
              <button
                className="journey-icon-button"
                title="Next step"
                aria-label="Next step"
                disabled={complete}
                onClick={() => move(cursor + 1)}
              >
                <SkipForward size={18} />
              </button>
              <button
                className="journey-icon-button"
                title="Restart scenario"
                aria-label="Restart scenario"
                onClick={() => move(0)}
              >
                <RotateCcw size={16} />
              </button>
            </div>
            <div
              className="journey-progress"
              role="group"
              aria-label="Walkthrough steps"
            >
              {scene.steps.map((s, i) => (
                <button
                  key={i}
                  className={i <= cursor ? "reached" : ""}
                  onClick={() => move(i)}
                  title={s.title}
                  aria-label={`Step ${i + 1}: ${s.title}`}
                  aria-current={i === cursor ? "step" : undefined}
                />
              ))}
            </div>
          </div>
        </div>
      </section>
      <div className="journey-explain-grid">
        <section
          className={`journey-inspector ${inspected.color}`}
          aria-label="Selected layer details"
        >
          <div className="journey-inspector-head">
            <span className="journey-inspector-icon">
              <InspectIcon size={25} />
            </span>
            <div>
              <span className="journey-overline">A CLOSER LOOK</span>
              <h2>{inspected.name}</h2>
            </div>
          </div>
          <h3>{inspected.question}</h3>
          <p>{inspected.description}</p>
          <ul>
            {inspected.checks.map((c) => (
              <li key={c}>
                <Check size={16} />
                {c}
              </li>
            ))}
          </ul>
          <button
            className="journey-technical-toggle"
            aria-expanded={technical}
            onClick={() => setTechnical(!technical)}
          >
            <SlidersHorizontal size={16} />
            {technical ? "Hide technical details" : "Show technical details"}
            <ChevronRight size={16} className={technical ? "expanded" : ""} />
          </button>
          {technical && (
            <div className="journey-technical">{inspected.technical}</div>
          )}
        </section>
        <section className="journey-trust-card">
          <span className="journey-overline">THREE DIFFERENT QUESTIONS</span>
          <h2>Identity is only the beginning.</h2>
          <div>
            <span className="trust-icon blue">
              <Fingerprint size={21} />
            </span>
            <div>
              <h3>Who are you?</h3>
              <p>
                Keycloak or Entra verifies your identity. Rust validates the
                result.
              </p>
            </div>
          </div>
          <div>
            <span className="trust-icon violet">
              <Shield size={21} />
            </span>
            <div>
              <h3>What may you do?</h3>
              <p>
                Rust maps your role to an allowed action. Redis keeps the
                session data.
              </p>
            </div>
          </div>
          <div>
            <span className="trust-icon cyan">
              <Network size={21} />
            </span>
            <div>
              <h3>Which service may enter?</h3>
              <p>
                The mesh verifies the calling service. Quarkus checks the
                internal caller again.
              </p>
            </div>
          </div>
        </section>
      </div>
      <section className="journey-session-life">
        <div className="journey-session-title">
          <div>
            <span className="journey-overline">THE LIFE OF YOUR SESSION</span>
            <h2>A session with a clear beginning. And an end.</h2>
            <p>Redis gives every Rust instance the same view of your access.</p>
          </div>
          <span className="journey-session-symbol">
            <Database size={28} />
          </span>
        </div>
        <div className="journey-lifecycle">
          {[
            {
              icon: KeyRound,
              title: "Sign in",
              text: "Your provider verifies you. Rust validates the result and creates a fresh session.",
            },
            {
              icon: Cookie,
              title: "Keep a private reference",
              text: "Your browser holds an opaque cookie. Identity and roles stay on the server.",
            },
            {
              icon: Clock3,
              title: "Check every request",
              text: "Rust checks permissions and refreshes idle expiry, within the absolute lifetime.",
            },
            {
              icon: X,
              title: "Expire or revoke",
              text: "Timeout, sign-out, or admin revocation invalidates access at the next check.",
            },
          ].map((item) => (
            <div key={item.title}>
              <span>
                <item.icon size={22} />
              </span>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="journey-reality">
        <div className="journey-reality-title">
          <CircleHelp size={20} />
          <h2>What can I try today?</h2>
        </div>
        <div>
          <h3>
            <Check size={16} /> Working in the local demo
          </h3>
          <p>
            Keycloak sign-in, Rust RBAC, Redis sessions, logout and revocation,
            CSRF checks, and the React / Quarkus application.
          </p>
        </div>
        <div>
          <h3>
            <Network size={16} /> Requires the cluster deployment
          </h3>
          <p>
            RHCL 1.5, Coraza WASM inspection, Service Mesh 3.5 ambient mTLS, and
            waypoint enforcement. The exact stack still needs cluster
            validation.
          </p>
        </div>
      </section>
    </div>
  );
}
function ActivityGlyph() {
  return (
    <span className="journey-activity-glyph">
      <span />
      <span />
      <span />
    </span>
  );
}
