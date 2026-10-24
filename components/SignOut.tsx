'use client'

import { useRouter } from 'next/navigation'
import { post } from './api'

export default function SignOut() {
  const router = useRouter()
  return (
    <button
      className="link"
      onClick={async () => {
        await post('/api/logout')
        router.push('/login')
        router.refresh()
      }}
    >
      Sign out
    </button>
  )
}
