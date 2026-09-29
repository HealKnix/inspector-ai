// Trigger + poll section analysis and generate the protocol for a run.
// Usage: node scripts/section-run.mjs --api URL --login U --password P
//        --object UUID --run UUID --params P078,P079 [--protocol] [--watch SEC]

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith("--")) acc.push([cur.slice(2), arr[i + 1]]);
    return acc;
  }, []),
);
const API = args.api ?? "http://127.0.0.1:3000";
const login = await fetch(`${API}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-inspector-request": "1" },
  body: JSON.stringify({ login: args.login, password: args.password }),
}).then((r) => r.json());
const token = login.access_token ?? login.accessToken;
if (!token)
  throw new Error("login failed: " + JSON.stringify(login).slice(0, 300));
const auth = {
  "content-type": "application/json",
  "x-inspector-request": "1",
  authorization: `Bearer ${token}`,
};

if (args.params) {
  const res = await fetch(
    `${API}/api/v1/objects/${args.object}/section-analysis`,
    {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        request_id: crypto.randomUUID(),
        expected_run_id: args.run,
        parameter_codes: args.params.split(","),
      }),
    },
  );
  console.log("section-analysis:", res.status, await res.text());
}

if (args.protocol) {
  const res = await fetch(
    `${API}/api/v1/objects/${args.object}/protocol/generate`,
    {
      method: "POST",
      headers: auth,
      body: "{}",
    },
  );
  console.log("protocol/generate:", res.status, await res.text());
}

if (args.status !== undefined || args.watch) {
  const until = Date.now() + Number(args.watch ?? 0) * 1000;
  for (;;) {
    const res = await fetch(
      `${API}/api/v1/objects/${args.object}/section-analysis?run_id=${args.run}`,
      { headers: auth },
    );
    const text = await res.text();
    console.log(
      `[${new Date().toISOString()}] status ${res.status}:`,
      text.slice(0, 2000),
    );
    if (res.status === 200 || Date.now() > until) break;
    await new Promise((r) => setTimeout(r, 30000));
  }
}
