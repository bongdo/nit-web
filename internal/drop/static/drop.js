(() => {
  const zone = document.querySelector("[data-dropzone]");
  const input = document.querySelector("[data-file-input]");
  const status = document.querySelector("[data-status]");

  const setStatus = (text, error = false) => {
    if (!status) return;
    status.textContent = text || "";
    status.classList.toggle("error", Boolean(error));
    if (text && error) status.scrollIntoView({ block: "nearest" });
  };

  const upload = async (files) => {
    if (!files?.length) return;
    const data = new FormData();
    for (const file of files) data.append("file", file, file.name);
    setStatus(`Uploading ${files.length}…`);
    try {
      const response = await fetch("api/upload", { method: "POST", body: data });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      location.reload();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Upload failed", true);
    }
  };

  const choose = () => input?.click();

  if (zone && input) {
    zone.addEventListener("click", choose);
    zone.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        choose();
      }
    });
    input.addEventListener("change", () => {
      const files = Array.from(input.files ?? []);
      input.value = "";
      void upload(files);
    });
  }

  let dragDepth = 0;
  document.addEventListener("dragenter", (event) => {
    if (!event.dataTransfer?.types?.includes("Files")) return;
    event.preventDefault();
    dragDepth++;
    zone?.classList.add("over");
  });
  document.addEventListener("dragover", (event) => {
    if (!event.dataTransfer?.types?.includes("Files")) return;
    event.preventDefault();
  });
  document.addEventListener("dragleave", (event) => {
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) zone?.classList.remove("over");
  });
  document.addEventListener("drop", (event) => {
    event.preventDefault();
    dragDepth = 0;
    zone?.classList.remove("over");
    void upload(event.dataTransfer?.files);
  });

  const copy = async (value) => {
    const text = new URL(value, location.href).href;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.append(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
  };

  const update = async (id, patch) => {
    const response = await fetch(`api/entries/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
  };

  document.addEventListener("click", async (event) => {
    const target = event.target.closest("button, a, summary");
    if (!target) return;

    const copyButton = target.closest("[data-copy]");
    if (copyButton) {
      event.preventDefault();
      await copy(copyButton.dataset.copy || "");
      const previous = copyButton.title;
      copyButton.title = "Copied";
      window.setTimeout(() => {
        copyButton.title = previous;
      }, 1200);
      return;
    }

    const publicButton = target.closest("[data-public]");
    if (publicButton) {
      event.preventDefault();
      const id = publicButton.closest("[data-entry]")?.dataset.entry;
      if (!id) return;
      const next = publicButton.dataset.public !== "1";
      publicButton.disabled = true;
      try {
        await update(id, { public: next });
        publicButton.dataset.public = next ? "1" : "0";
        publicButton.setAttribute("aria-pressed", String(next));
        publicButton.title = next ? "Anonymous access on" : "Anonymous access off";
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Update failed", true);
      } finally {
        publicButton.disabled = false;
      }
      return;
    }

    const expireButton = target.closest("[data-expire]");
    if (expireButton) {
      event.preventDefault();
      const id = expireButton.closest("[data-entry]")?.dataset.entry;
      if (!id) return;
      const forever = expireButton.dataset.expire !== "1";
      expireButton.disabled = true;
      try {
        await update(id, { forever });
        location.reload();
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Update failed", true);
        expireButton.disabled = false;
      }
      return;
    }

    const editButton = target.closest("[data-edit-slug]");
    if (editButton) {
      event.preventDefault();
      const item = editButton.closest("[data-entry]");
      const form = item?.querySelector(".slug-form");
      if (!form) return;
      form.hidden = false;
      const field = form.querySelector("input");
      field?.focus();
      field?.select();
      return;
    }

    const cancel = target.closest("[data-cancel]");
    if (cancel) {
      event.preventDefault();
      const form = cancel.closest(".slug-form");
      if (form) form.hidden = true;
      return;
    }

    const deleteButton = target.closest("[data-delete]");
    if (deleteButton) {
      event.preventDefault();
      const id = deleteButton.closest("[data-entry]")?.dataset.entry;
      if (!id || !confirm("Delete this drop?")) return;
      deleteButton.disabled = true;
      try {
        const response = await fetch(`api/entries/${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        location.reload();
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Delete failed", true);
        deleteButton.disabled = false;
      }
    }
  });

  document.addEventListener("submit", async (event) => {
    const form = event.target.closest(".slug-form");
    if (!form) return;
    event.preventDefault();
    const id = form.closest("[data-entry]")?.dataset.entry;
    const field = form.querySelector("input");
    if (!id || !field) return;
    const slug = field.value.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug) || slug.endsWith("-")) {
      setStatus("Use lowercase letters, numbers and dashes", true);
      return;
    }
    try {
      await update(id, { slug });
      location.reload();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Update failed", true);
    }
  });
})();
