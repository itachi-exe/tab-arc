/**
 * Photon Spectrum: the iMessage line Tab texts on.
 * Shared lines only answer numbers registered on the project, so joining Tab
 * registers your number here first. Credentials stay server side.
 */

const HOST = process.env.PHOTON_SPECTRUM_HOST ?? "https://spectrum.photon.codes";
const PROJECT = process.env.PHOTON_PROJECT_ID ?? "";
const SECRET = process.env.PHOTON_PROJECT_SECRET ?? "";

export const photonOn = PROJECT.length > 0 && SECRET.length > 0;
export const TAB_LINE = process.env.TAB_LINE ?? "";

const auth = () => ({ Authorization: "Basic " + Buffer.from(`${PROJECT}:${SECRET}`).toString("base64") });
const digits = (p: string) => p.replace(/[^\d+]/g, "");

type SpectrumUser = { id?: string; phoneNumber?: string; assignedPhoneNumber?: string };

async function listUsers(): Promise<SpectrumUser[]> {
  const r = await fetch(`${HOST}/projects/${PROJECT}/users/`, { headers: auth() });
  if (!r.ok) throw new Error(`photon list ${r.status}`);
  const d = (await r.json()) as unknown;
  if (Array.isArray(d)) return d as SpectrumUser[];
  const o = d as { data?: SpectrumUser[] | { users?: SpectrumUser[] }; users?: SpectrumUser[] };
  if (Array.isArray(o.data)) return o.data;
  return o.data?.users ?? o.users ?? [];
}

/** Registers the number on Tab's line (idempotent). Returns the line to text. */
export async function registerNumber(phone: string, firstName: string): Promise<string> {
  if (!photonOn) throw new Error("PHOTON_OFF");
  const want = digits(phone);
  const existing = (await listUsers()).find((u) => digits(u.phoneNumber ?? "") === want);
  if (existing) return existing.assignedPhoneNumber || TAB_LINE;
  const r = await fetch(`${HOST}/projects/${PROJECT}/users/`, {
    method: "POST",
    headers: { ...auth(), "Content-Type": "application/json" },
    body: JSON.stringify({ type: "shared", phoneNumber: want, firstName: firstName.slice(0, 32) }),
  });
  if (!r.ok) throw new Error(`photon create ${r.status} ${(await r.text()).slice(0, 160)}`);
  const d = (await r.json()) as { user?: SpectrumUser; data?: SpectrumUser } & SpectrumUser;
  const u = d.user ?? d.data ?? d;
  return u.assignedPhoneNumber || TAB_LINE;
}
