'use client'

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="login">
      <div className="glass">
        <h1>Something went wrong</h1>
        <p className="meta" style={{ fontSize: 15 }}>
          The orders could not be loaded. Nothing was changed.
        </p>
        <button className="btn primary" onClick={reset}>
          Try again
        </button>
      </div>
    </main>
  )
}
