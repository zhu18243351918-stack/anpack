import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const decodeBase64 = (value: string) => Uint8Array.from(atob(value), char => char.charCodeAt(0))
const encodeBase64 = (value: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(value)))

async function handleRequest(request: Request) {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const authorization = request.headers.get('Authorization') ?? ''
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } })
    const { data, error } = await client.auth.getUser(); if (error || !data.user) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } })
    const issuedAt = new Date(); const expiresAt = new Date(issuedAt.getTime() + 30 * 24 * 60 * 60 * 1000)
    const payload = { userId: data.user.id, issuedAt: issuedAt.toISOString(), expiresAt: expiresAt.toISOString() }
    const privateKey = await crypto.subtle.importKey('pkcs8', decodeBase64(Deno.env.get('OFFLINE_RECEIPT_PRIVATE_KEY_PKCS8')!), { name: 'Ed25519' }, false, ['sign'])
    const signature = await crypto.subtle.sign({ name: 'Ed25519' }, privateKey, new TextEncoder().encode(JSON.stringify(payload)))
    return new Response(JSON.stringify({ payload, signature: encodeBase64(signature) }), { headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
  } catch (error) { return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'receipt_failed' }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }) }
}

export default { fetch: handleRequest }
