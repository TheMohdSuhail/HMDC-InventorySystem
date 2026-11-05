"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="login">
      <section className="panel">
        <h1>Unable to load inventory</h1>
        <p>
          Check your database connection and server configuration, then retry.
        </p>
        <button onClick={reset}>Try again</button>
      </section>
    </main>
  );
}
