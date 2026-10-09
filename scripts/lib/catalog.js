// Fetches the live model catalogs. fetch is injectable so tests never touch the network.

export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
export const NVIDIA_MODELS_URL = 'https://integrate.api.nvidia.com/v1/models';

export async function fetchCatalog(url, fetchImpl = fetch, headers = {}) {
  const res = await fetchImpl(url, { headers });
  if (!res.ok) throw new Error(`${url} answered HTTP ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json?.data)) throw new Error(`${url} returned an unexpected shape (no data array)`);
  return json.data;
}
