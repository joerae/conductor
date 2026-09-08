/**
 * versionModal.ts
 *
 * Manages the version & release history modal and fetching /version.json.
 */

export interface VersionHistoryItem {
  version: string;
  date: string;
  summary: string;
  details: string[];
}

export interface VersionData {
  version: string;
  name: string;
  localUrl: string;
  history: VersionHistoryItem[];
}

export class VersionModal {
  private versionBtn: HTMLButtonElement | null;
  private versionModal: HTMLElement | null;
  private closeModalBtn: HTMLButtonElement | null;
  private modalContent: HTMLElement | null;

  constructor() {
    this.versionBtn = document.getElementById("version-btn") as HTMLButtonElement | null;
    this.versionModal = document.getElementById("version-modal");
    this.closeModalBtn = document.getElementById("close-modal-btn") as HTMLButtonElement | null;
    this.modalContent = document.getElementById("modal-content");

    this.initEventListeners();
  }

  isOpen(): boolean {
    return this.versionModal?.style.display === "flex";
  }

  open(): void {
    if (this.versionModal) {
      this.versionModal.style.display = "flex";
    }
  }

  close(): void {
    if (this.versionModal) {
      this.versionModal.style.display = "none";
    }
  }

  private initEventListeners(): void {
    this.versionBtn?.addEventListener("click", () => this.open());
    this.closeModalBtn?.addEventListener("click", () => this.close());
    this.versionModal?.addEventListener("click", (e) => {
      if (e.target === this.versionModal) {
        this.close();
      }
    });
  }

  async loadVersionInfo(): Promise<void> {
    try {
      const res = await fetch("/version.json");
      if (!res.ok) return;
      const data: VersionData = await res.json();
      if (this.versionBtn) {
        this.versionBtn.textContent = `v${data.version}`;
      }

      if (this.modalContent) {
        this.modalContent.innerHTML =
          data.history
            .map(
              item => `
          <div class="version-entry">
            <div class="version-tag-row">
              <span class="version-badge">v${item.version}</span>
              <span class="version-date">${item.date}</span>
            </div>
            <div class="version-summary">${item.summary}</div>
            <ul class="version-details-list">
              ${item.details.map(d => `<li>${d}</li>`).join("")}
            </ul>
          </div>
        `
            )
            .join("") +
          `
          <div style="margin-top: 16px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.08); font-size: 0.75rem; color: var(--text-muted);">
            Dev Server: <a href="${data.localUrl}" target="_blank" style="color: var(--accent-gold); text-decoration: none;">${data.localUrl}</a>
          </div>
        `;
      }
    } catch (err) {
      console.warn("Could not load version.json", err);
    }
  }
}
