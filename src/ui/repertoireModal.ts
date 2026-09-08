/**
 * repertoireModal.ts
 *
 * Manages the piece selection modal dialog and list rendering.
 */

import type { ExperienceController } from "../experience/ExperienceController";

export class RepertoireModal {
  private repertoireBtn: HTMLButtonElement | null;
  private repertoireModal: HTMLElement | null;
  private closeRepertoireBtn: HTMLButtonElement | null;
  private repertoireList: HTMLElement | null;

  private controller: ExperienceController;
  private onSwitchPiece: (pieceId: string) => Promise<void> | void;

  constructor(
    controller: ExperienceController,
    onSwitchPiece: (pieceId: string) => Promise<void> | void
  ) {
    this.controller = controller;
    this.onSwitchPiece = onSwitchPiece;
    this.repertoireBtn = document.getElementById("repertoire-btn") as HTMLButtonElement | null;
    this.repertoireModal = document.getElementById("repertoire-modal");
    this.closeRepertoireBtn = document.getElementById("close-repertoire-btn") as HTMLButtonElement | null;
    this.repertoireList = document.getElementById("repertoire-list");

    this.initEventListeners();
  }

  isOpen(): boolean {
    return this.repertoireModal?.style.display === "flex";
  }

  open(): void {
    this.renderList();
    if (this.repertoireModal) {
      this.repertoireModal.style.display = "flex";
    }
  }

  close(): void {
    if (this.repertoireModal) {
      this.repertoireModal.style.display = "none";
    }
  }

  renderList(): void {
    if (!this.repertoireList) return;
    const currentPiece = this.controller.getCurrentPiece();
    const pieces = this.controller.getRepertoire();

    this.repertoireList.innerHTML = pieces
      .map(piece => {
        const isActive = piece.id === currentPiece.id;
        return `
        <div class="piece-card ${isActive ? "active-piece" : ""}">
          <div class="piece-card-info">
            <div class="piece-card-title">${piece.title}</div>
            <div class="piece-card-composer">${piece.composer} — ${piece.movement} (${piece.year}) • <span style="color:#ffd56b">${piece.conductMode || "Standard"}</span></div>
            <div class="piece-card-desc">${piece.description}</div>
          </div>
          <button class="piece-select-btn" data-piece-id="${piece.id}">
            ${isActive ? "Currently Conducting" : "Conduct This Piece"}
          </button>
        </div>
      `;
      })
      .join("");

    this.repertoireList.querySelectorAll<HTMLButtonElement>(".piece-select-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const pieceId = btn.dataset.pieceId;
        if (!pieceId) return;
        this.close();
        await this.onSwitchPiece(pieceId);
      });
    });
  }

  private initEventListeners(): void {
    this.repertoireBtn?.addEventListener("click", () => this.open());
    this.closeRepertoireBtn?.addEventListener("click", () => this.close());
    this.repertoireModal?.addEventListener("click", (e) => {
      if (e.target === this.repertoireModal) {
        this.close();
      }
    });
  }
}
