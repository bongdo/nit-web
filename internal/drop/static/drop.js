(() => {
  const form = document.querySelector("[data-upload-form]");
  const zone = document.querySelector("[data-dropzone]");
  const input = document.querySelector("[data-file-input]");
  const pick = document.querySelector("[data-pick]");
  const status = document.querySelector("[data-status]");
  let selected = null;

  const setStatus = (text, error) => {
    if (!status) return;
    status.textContent = text || "";
    status.classList.toggle("err", Boolean(error));
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
      selected = input.files;
      setStatus(selected?.length ? `${selected.length} файл(ов) выбрано` : "", false);
    });
    for (const event of ["dragenter", "dragover"]) {
      zone.addEventListener(event, (e) => {
        e.preventDefault();
        zone.classList.add("over");
      });
    }
    for (const event of ["dragleave", "drop"]) {
      zone.addEventListener(event, (e) => {
        e.preventDefault();
        zone.classList.remove("over");
      });
    }
    zone.addEventListener("drop", (e) => {
      const files = e.dataTransfer?.files;
      if (!files?.length) return;
      selected = files;
      setStatus(`${files.length} файл(ов) выбрано`, false);
    });
  }

  pick?.addEventListener("click", choose);

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const files = selected?.length ? selected : input?.files;
    if (!files?.length) {
      setStatus("Выбери файл", true);
      return;
    }
    const data = new FormData();
    data.append("ttl", form.querySelector("[name=ttl]")?.value || "7d");
    for (const file of files) data.append("file", file, file.name);
    setStatus("Загружаю…", false);
    try {
      const response = await fetch("api/upload", { method: "POST", body: data });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      location.reload();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось загрузить", true);
    }
  });

  const copy = async (value) => {
    const text = value ? new URL(value, location.href).href : location.href;
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

  document.addEventListener("click", async (event) => {
    const copyButton = event.target.closest("[data-copy]");
    if (copyButton) {
      event.preventDefault();
      await copy(copyButton.dataset.copy || "");
      const previous = copyButton.textContent;
      copyButton.textContent = "скопировано";
      setTimeout(() => {
        copyButton.textContent = previous;
      }, 1200);
      return;
    }
    const deleteButton = event.target.closest("[data-delete]");
    if (deleteButton) {
      event.preventDefault();
      const id = deleteButton.dataset.delete;
      if (!id || !confirm("Удалить публикацию?")) return;
      const response = await fetch("api/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (response.ok) {
        location.reload();
      } else {
        setStatus("Не удалось удалить", true);
      }
    }
  });
})();
