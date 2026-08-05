import { generateKeyPairSync } from 'node:crypto'

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const rawPublic = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)
const pkcs8Private = privateKey.export({ format: 'der', type: 'pkcs8' })
console.log('VITE_OFFLINE_RECEIPT_PUBLIC_KEY=' + rawPublic.toString('base64'))
console.log('OFFLINE_RECEIPT_PRIVATE_KEY_PKCS8=' + pkcs8Private.toString('base64'))
