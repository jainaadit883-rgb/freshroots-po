// Turns a Zoho Self Client code into a refresh token and stores the Zoho settings in Vercel.
// Secrets are typed here, in your terminal, and go straight to Vercel. Run: node scripts/connect-zoho.mjs
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'

const DC = (process.env.ZOHO_DC || 'in').toLowerCase()
const HOSTS = {
  in: ['accounts.zoho.in', 'www.zohoapis.in'],
  com: ['accounts.zoho.com', 'www.zohoapis.com'],
  eu: ['accounts.zoho.eu', 'www.zohoapis.eu'],
  au: ['accounts.zoho.com.au', 'www.zohoapis.com.au'],
  ca: ['accounts.zohocloud.ca', 'www.zohoapis.ca'],
}
if (!HOSTS[DC]) {
  console.error(`Unknown data centre "${DC}". Use in, com, eu, au or ca.`)
  process.exit(1)
}
const [accountsHost, apiHost] = HOSTS[DC]

function ask(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    if (hidden) {
      rl._writeToOutput = (s) => {
        if (s.includes(question) || s.includes('\n')) process.stdout.write(s)
      }
    }
    rl.question(question, (answer) => {
      rl.close()
      if (hidden) console.log(`  (${answer.trim().length} characters)`)
      resolve(answer.trim())
    })
  })
}

function vercelBin() {
  const local = path.join(os.homedir(), '.local/bin/vercel')
  if (spawnSync('vercel', ['--version']).status === 0) return 'vercel'
  if (existsSync(local)) return local
  console.error('Could not find the Vercel CLI.')
  process.exit(1)
}

function setVercel(bin, name, value, sensitive) {
  spawnSync(bin, ['env', 'rm', name, 'production', '--yes'], { stdio: 'ignore' })
  const args = ['env', 'add', name, 'production', '--yes', ...(sensitive ? ['--sensitive'] : [])]
  const res = spawnSync(bin, args, { input: value, encoding: 'utf8' })
  if (res.status !== 0) {
    console.error(`Could not save ${name} in Vercel.`)
    process.exit(1)
  }
  console.log(`  saved ${name}`)
}

const clientId = await ask('Client ID: ')
const clientSecret = await ask('Client Secret (hidden): ', true)
const orgId = await ask('Organization ID: ')
const code = await ask('Code from the Generate Code tab (hidden): ', true)
if (!clientId || !clientSecret || !orgId || !code) {
  console.error('All four values are needed.')
  process.exit(1)
}

console.log('\nAsking Zoho for a refresh token…')
const tokenRes = await fetch(`https://${accountsHost}/oauth/v2/token`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, client_secret: clientSecret, code }),
})
const token = await tokenRes.json().catch(() => ({}))
if (!token.refresh_token) {
  console.error(`Zoho said: ${token.error ?? 'no refresh token returned'}.`)
  if (token.error === 'invalid_client' || token.error === 'invalid_client_secret') {
    console.error('Zoho did not accept the Client ID or Client Secret. A Zoho client secret is 42 characters. Use the copy icons and run this again.')
  } else {
    console.error('The code lasts only a few minutes and works once. Generate a fresh one and run this again.')
  }
  process.exit(1)
}

console.log('Checking the Organization ID and permissions…')
const check = await fetch(`https://${apiHost}/inventory/v1/items?organization_id=${encodeURIComponent(orgId)}&per_page=1`, {
  headers: { authorization: `Zoho-oauthtoken ${token.access_token}` },
})
const checked = await check.json().catch(() => ({}))
if (!check.ok || checked.code !== 0) {
  console.error(`Zoho Inventory refused the check: ${checked.message ?? check.status}`)
  console.error('Look at the Organization ID, and make sure the code was generated with all four scopes.')
  process.exit(1)
}
console.log('  Zoho Inventory accepted it.\n\nSaving to Vercel…')

const bin = vercelBin()
setVercel(bin, 'ZOHO_CLIENT_ID', clientId, true)
setVercel(bin, 'ZOHO_CLIENT_SECRET', clientSecret, true)
setVercel(bin, 'ZOHO_REFRESH_TOKEN', token.refresh_token, true)
setVercel(bin, 'ZOHO_ORG_ID', orgId, false)
setVercel(bin, 'ZOHO_DC', DC, false)
console.log('\nDone. Tell Claude, and it will redeploy.')
