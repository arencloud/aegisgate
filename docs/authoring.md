[Documentation home](README.md) / Documentation authoring

# Make every explanation easy to follow

A good AegisGate page answers a concrete question, shows the relevant path, and
points to the configuration or evidence behind its claims. Keep the documentation
reviewable in Git and useful in an ordinary Markdown viewer.

## The page pattern

1. **Lead with the reader's outcome.** State what the page helps them understand or do.
2. **Show one visual at a time.** Follow it with enough text to explain the same information without the image.
3. **Name the decision owner.** Say whether a result comes from Coraza, Authorino/Rust, a mesh policy, or Quarkus.
4. **Separate the story from the deployment.** A simplified UI walkthrough is not a literal network graph or live test result.
5. **End with a useful next page.** Prefer a connected reading path over unrelated links.

Use the existing AegisGate branding, restrained teal/violet diagrams, short tables,
and meaningful alt text. Keep animation optional by putting GIFs in expandable
sections next to a still image. Readers should never need motion to understand
the guide. Avoid live badges that imply continuous verification unless such a
check actually exists.

## Update the right source

| When this changes… | Review these documents and assets |
| --- | --- |
| UI scenario names or steps | [How it works](how-it-works.md), scenario GIFs/stills, `manifest.json` |
| Services, routes, policies, trust domain | [Architecture](architecture.md), deployment guides |
| TTLs, cookies, RBAC, OIDC behavior | [Identity and sessions](identity-and-sessions.md), browser expectations |
| Deployment verification | Expected checks in [Browser demo guide](demo-guide.md#deployment-verification) |
| Operator or application versions | Root README and the specific installation guide |

The implementation remains the source of truth. Link to files rather than
copying large manifests into prose, and distinguish a base from its example overlay.
Never include real passwords, tokens, session cookies, exported realm credentials,
or screenshots of authenticated account data.

## Regenerate the showcase media

The capture script visits the real React walkthrough and steps through its
controls. It stubs only the signed-out provider/session responses, so it requires
no Keycloak, Redis, real users, or cluster access. Each captured scenario is an
illustration, not a network test.

From the repository root:

```sh
npm ci --prefix webui
(cd webui && npx playwright install chromium)
npm run dev --prefix webui -- --port 4173
```

In a second terminal, install the small encoding tools outside the repository
and generate the assets:

```sh
npm install --prefix /tmp/aegisgate-doc-media --no-audit --no-fund \
  gifenc@1.0.3 pngjs@7.0.0
NODE_PATH=/tmp/aegisgate-doc-media/node_modules \
  node scripts/docs/capture-journeys.cjs
```

Set `DOCS_UI_URL` if the local frontend uses another address. The script writes:

- `docs/assets/journeys/<scenario>.png`: a still of the completed scenario.
- `docs/assets/journeys/<scenario>.gif`: all scenario steps with readable pauses.
- `docs/assets/journeys/manifest.json`: the captured step labels and GIF sizes.

The screenshots preserve the UI styling. GIF encoding reduces the color palette;
use the PNGs for crisp still images. The six GIFs together are approximately
2.1 MiB in the initial capture. Browser/font changes can affect output bytes, so
review the images visually rather than expecting byte-for-byte reproducibility.

## Review before publishing

Check that local links and image paths resolve, all six scenarios have matching
media, and Markdown tables and expandable sections render correctly. Render
Mermaid diagrams in a supporting viewer and verify their labels against the
current manifests. The surrounding prose should remain understandable if a
viewer does not support Mermaid.

For each behavioral statement, ask: is this **implemented**, **configured**, or
**observed in a dated check**? State the appropriate level. Test descriptions
must include expected outcomes and the evidence that distinguishes the intended
control from another source of the same status code.

Documentation-only edits do not require rebuilding or deploying the application.
If the UI narrative or runtime behavior also changes, validate those changes
separately and regenerate affected media.

---

[← Documentation home](README.md) · [Walkthrough source](../webui/src/Journey.tsx) · [Capture script](../scripts/docs/capture-journeys.cjs)
