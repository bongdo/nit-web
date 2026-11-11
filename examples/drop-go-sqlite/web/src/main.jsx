import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

async function api(path, options) {
  const response = await fetch(`api/${path}`, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${response.status}`);
  }
  return response.status === 204 ? null : response.json();
}

function App() {
  const [items, setItems] = useState([]);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api("notes")
      .then(setItems)
      .catch((problem) => setError(problem.message))
      .finally(() => setLoading(false));
  }, []);

  async function add(event) {
    event.preventDefault();
    const value = text.trim();
    if (!value || saving) return;
    setSaving(true);
    setError("");
    try {
      const note = await api("notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: value }),
      });
      setItems((current) => [note, ...current]);
      setText("");
    } catch (problem) {
      setError(problem.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id) {
    setError("");
    try {
      await api(`notes/${id}`, { method: "DELETE" });
      setItems((current) => current.filter((item) => item.id !== id));
    } catch (problem) {
      setError(problem.message);
    }
  }

  return (
    <main className="page">
      <header className="head">
        <div className="brand">
          <span className="mark">n</span>
          <span>notes</span>
        </div>
        <span className="stack">Go · SQLite · React</span>
      </header>

      <section className="hero">
        <h1>Маленький сервис, который помнит.</h1>
        <p>
          Данные лежат в SQLite на volume <code>/data</code>. Перезапуск и{" "}
          <code>drop update</code> их не стирают.
        </p>
      </section>

      <form className="composer" onSubmit={add}>
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Заметка на память…"
          maxLength={500}
          aria-label="Новая заметка"
        />
        <button type="submit" disabled={saving || !text.trim()}>
          {saving ? "Сохраняю…" : "Добавить"}
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      {loading ? (
        <div className="empty">Читаю SQLite…</div>
      ) : items.length === 0 ? (
        <div className="empty">
          Пока пусто. Добавьте первую заметку — она останется после деплоя.
        </div>
      ) : (
        <ul className="list">
          {items.map((item) => (
            <li key={item.id} className="item">
              <div className="text">{item.text}</div>
              <time>{new Date(item.created).toLocaleString("ru-RU")}</time>
              <button
                type="button"
                className="remove"
                onClick={() => remove(item.id)}
                aria-label="Удалить заметку"
                title="Удалить"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <footer className="foot">
        <span className="dot" aria-hidden="true" />
        {items.length} {items.length === 1 ? "заметка" : "заметок"} · SQLite
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
