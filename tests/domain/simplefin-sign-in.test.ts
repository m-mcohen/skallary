// tests/domain/simplefin-sign-in.test.ts
//
// When one connection asks for a fresh sign-in on the Bridge (con.auth), the app
// must not read that warning as "the whole feed is dead": the other connections
// keep importing. These pin the split between one bank needing a sign-in and the
// access itself being gone.
import { describe, expect, it } from "vitest";
import { mapSimpleFinResponse, signInNeeded } from "../../src/domain/simplefin";

describe("mapSimpleFinResponse", () => {
  it("names the connection an error belongs to", () => {
    const mapped = mapSimpleFinResponse({
      accounts: [],
      connections: [{ conn_id: "CON-1", name: "Ridgeline Example Investments", org_id: "o", sfin_url: "https://x" }],
      errlist: [{ code: "con.auth", msg: "Auth required", conn_id: "CON-1" }],
    });
    expect(mapped.errors[0].connectionName).toBe("Ridgeline Example Investments");
  });
});

describe("signInNeeded", () => {
  const err = (code: string, message: string, connectionName?: string | null) => ({
    code, message, accountId: null, connectionId: null, connectionName,
  });

  it("lists each connection that needs a sign-in once, and only those", () => {
    expect(
      signInNeeded([
        err("con.auth", "Auth required", "Ridgeline Example Investments"),
        err("con.auth", "Auth required", "Ridgeline Example Investments"),
        err("act.failed", "bank timeout", "Pinecrest Example Bank"),
        err("gen.api", "Requested date range exceeds recommended range"),
        err("gen.auth", "access revoked"),
      ])
    ).toEqual(["Ridgeline Example Investments"]);
  });

  it("reads the name from the Bridge's own wording when an older saved warning has none", () => {
    // What an older saved warning looks like, from before errors carried a connection name.
    expect(
      signInNeeded([err("con.auth", "Connection to Ridgeline Example Investments may need attention. Auth required")])
    ).toEqual(["Ridgeline Example Investments"]);
  });

  it("still says something when the name cannot be found", () => {
    expect(signInNeeded([err("con.auth", "reauthorize")])).toEqual(["A bank connection"]);
  });
});
