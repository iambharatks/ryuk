// A software passkey for tests: a real P-256 key, real WebAuthn registration and assertion responses
// (attestation "none"), signed the way a phone would. Only the bits the server checks are filled in.
const enc = new TextEncoder();
const b64u = (b) => Buffer.from(b).toString("base64url");
const sha256 = async (b) => new Uint8Array(await crypto.subtle.digest("SHA-256", b));
const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

// --- minimal CBOR encoder: ints, byte strings, text, maps ---
function head(major, n) {
  if (n < 24) return Uint8Array.of((major << 5) | n);
  if (n < 256) return Uint8Array.of((major << 5) | 24, n);
  if (n < 65536) return Uint8Array.of((major << 5) | 25, n >> 8, n & 255);
  return Uint8Array.of((major << 5) | 26, (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
}
function cbor(v) {
  if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (v instanceof Uint8Array) return cat(head(2, v.length), v);
  if (typeof v === "string") { const b = enc.encode(v); return cat(head(3, b.length), b); }
  if (v instanceof Map) return cat(head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)]));
  throw new Error("cbor: unsupported " + typeof v);
}

// raw r||s (WebCrypto) -> DER (WebAuthn)
function der(sig) {
  const int = (b) => { let i = 0; while (i < b.length - 1 && b[i] === 0) i++; b = b.slice(i); if (b[0] & 0x80) b = cat(Uint8Array.of(0), b); return cat(Uint8Array.of(2, b.length), b); };
  const r = int(sig.slice(0, 32)), s = int(sig.slice(32));
  return cat(Uint8Array.of(0x30, r.length + s.length), r, s);
}

export async function softKey() {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
  const credId = crypto.getRandomValues(new Uint8Array(16));
  let counter = 0;
  const cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, new Uint8Array(Buffer.from(jwk.x, "base64url"))], [-3, new Uint8Array(Buffer.from(jwk.y, "base64url"))]]));
  const clientData = (type, challenge, origin) => enc.encode(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  const counterBytes = (n) => Uint8Array.of((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);

  return {
    id: b64u(credId),
    /** navigator.credentials.create() as the server sees it */
    async register(opts, origin) {
      const cd = clientData("webauthn.create", opts.challenge, origin);
      const authData = cat(await sha256(enc.encode(opts.rp.id)), Uint8Array.of(0x45), counterBytes(0), new Uint8Array(16), Uint8Array.of(0, credId.length), credId, cose);
      const att = cbor(new Map([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]));
      return { id: b64u(credId), rawId: b64u(credId), type: "public-key", clientExtensionResults: {}, authenticatorAttachment: "platform",
        response: { clientDataJSON: b64u(cd), attestationObject: b64u(att), transports: ["internal", "hybrid"] } };
    },
    /** navigator.credentials.get() as the server sees it */
    async assert(opts, origin, { rpId = opts.rpId, uv = true, id = credId } = {}) {
      counter++;
      const cd = clientData("webauthn.get", opts.challenge, origin);
      const authData = cat(await sha256(enc.encode(rpId)), Uint8Array.of(uv ? 0x05 : 0x01), counterBytes(counter));
      const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, kp.privateKey, cat(authData, await sha256(cd))));
      return { id: b64u(id), rawId: b64u(id), type: "public-key", clientExtensionResults: {}, authenticatorAttachment: "platform",
        response: { clientDataJSON: b64u(cd), authenticatorData: b64u(authData), signature: b64u(der(sig)), userHandle: b64u(enc.encode("ryuk-owner")) } };
    },
  };
}
